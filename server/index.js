import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { z } from "zod";
import { pool } from "./db.js";
import { requireUser, requireApiKey } from "./auth.js";
import { sha256, newApiKey, safeEqualHex } from "./security.js";
import { createProviderOrder } from "./provider.js";

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be configured with at least 32 characters.");
}
const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: (process.env.CORS_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean) }));
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

// Webhook needs raw bytes for provider signature verification; mount before express.json().
app.post("/webhooks/razorpay", express.raw({ type: "application/json", limit: "1mb" }), async (req, res, next) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.get("X-Razorpay-Signature") || "";
    if (!secret) return res.status(503).send("Webhook not configured");
    const expected = crypto.createHmac("sha256", secret).update(req.body).digest("hex");
    if (!safeEqualHex(expected, signature)) return res.status(400).send("Invalid signature");
    const event = JSON.parse(req.body.toString("utf8"));
    const eventId = req.get("X-Razorpay-Event-Id") || null;
    await pool.query(
      "INSERT INTO webhook_events(provider_event_id,event_type,payload) VALUES($1,$2,$3) ON CONFLICT(provider_event_id) DO NOTHING",
      [eventId, event.event || "unknown", event]
    );
    if (event.event === "payment.captured") {
      const payment = event.payload?.payment?.entity;
      if (payment?.order_id) {
        await pool.query(
          `UPDATE payment_orders SET status='paid', provider_payment_id=$1, updated_at=now()
           WHERE provider_order_id=$2 AND status <> 'paid'`,
          [payment.id, payment.order_id]
        );
      }
    } else if (event.event === "payment.failed") {
      const payment = event.payload?.payment?.entity;
      if (payment?.order_id) {
        await pool.query(
          `UPDATE payment_orders SET status='failed', provider_payment_id=$1, updated_at=now()
           WHERE provider_order_id=$2 AND status NOT IN ('paid','failed')`,
          [payment.id, payment.order_id]
        );
      }
    }
    res.json({ received: true });
  } catch (e) { next(e); }
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(new URL("../public", import.meta.url).pathname));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

const signupSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128)
});
app.post("/api/auth/signup", async (req, res, next) => {
  try {
    const data = signupSchema.parse(req.body);
    const hash = await bcrypt.hash(data.password, 12);
    const result = await pool.query(
      "INSERT INTO merchants(name,email,password_hash) VALUES($1,lower($2),$3) RETURNING id,name,email",
      [data.name, data.email, hash]
    );
    const merchant = result.rows[0];
    const token = jwt.sign({ sub: merchant.id, email: merchant.email }, process.env.JWT_SECRET, { expiresIn: "2h", issuer: "famupigateway" });
    res.status(201).json({ merchant, token });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Email already registered" });
    next(e);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const email = z.string().email().parse(req.body.email).toLowerCase();
    const password = z.string().min(1).max(128).parse(req.body.password);
    const result = await pool.query("SELECT id,name,email,password_hash FROM merchants WHERE email=$1", [email]);
    const row = result.rows[0];
    if (!row || !(await bcrypt.compare(password, row.password_hash))) return res.status(401).json({ error: "Invalid credentials" });
    const token = jwt.sign({ sub: row.id, email: row.email }, process.env.JWT_SECRET, { expiresIn: "2h", issuer: "famupigateway" });
    res.json({ merchant: { id: row.id, name: row.name, email: row.email }, token });
  } catch (e) { next(e); }
});

app.get("/api/dashboard", requireUser, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT count(*)::int AS total_requests,
       count(*) FILTER (WHERE status='paid')::int AS successful,
       count(*) FILTER (WHERE status IN ('failed','cancelled'))::int AS failed,
       COALESCE(sum(amount_paise) FILTER (WHERE status='paid'),0)::text AS revenue_paise
       FROM payment_orders WHERE merchant_id=$1`, [req.user.sub]);
    res.json(result.rows[0]);
  } catch (e) { next(e); }
});

app.post("/api/keys", requireUser, async (req, res, next) => {
  try {
    const key = newApiKey();
    await pool.query(
      "INSERT INTO api_keys(merchant_id,key_prefix,key_hash,label) VALUES($1,$2,$3,$4)",
      [req.user.sub, key.slice(0, 14), sha256(key), (req.body.label || "Default key").slice(0, 80)]
    );
    // The raw key is returned only once. Store it securely on the merchant's server.
    res.status(201).json({ api_key: key, warning: "Copy now. This secret will not be shown again." });
  } catch (e) { next(e); }
});

const orderSchema = z.object({
  amount: z.number().positive().max(10000000),
  order_id: z.string().trim().min(1).max(80),
  customer_name: z.string().trim().max(100).optional(),
  customer_email: z.string().email().max(254).optional(),
  description: z.string().trim().max(200).optional()
});

// Merchant server calls this endpoint with X-API-Key. Amount is INR and converted to paise.
app.post("/api/v1/orders", requireApiKey, async (req, res, next) => {
  try {
    const data = orderSchema.parse(req.body);
    const amountPaise = Math.round(data.amount * 100);
    const existing = await pool.query(
      "SELECT id,merchant_order_id,amount_paise,currency,status,checkout_url FROM payment_orders WHERE merchant_id=$1 AND merchant_order_id=$2",
      [req.merchantId, data.order_id]
    );
    if (existing.rowCount) {
      const old = existing.rows[0];
      if (Number(old.amount_paise) !== amountPaise) return res.status(409).json({ error: "order_id already exists with a different amount" });
      return res.json({ status: "success", data: { ...old, amount: Number(old.amount_paise) / 100 } });
    }
    const created = await pool.query(
      `INSERT INTO payment_orders(merchant_id,merchant_order_id,amount_paise,customer_name,customer_email,description,status)
       VALUES($1,$2,$3,$4,$5,$6,'pending') RETURNING id,merchant_order_id,amount_paise,currency,status`,
      [req.merchantId, data.order_id, amountPaise, data.customer_name || null, data.customer_email || null, data.description || null]
    );
    const local = created.rows[0];
    const providerOrder = await createProviderOrder({
      amountPaise, receipt: local.id,
      notes: { merchant_order_id: data.order_id, gateway_order_id: local.id }
    });
    await pool.query(
      "UPDATE payment_orders SET provider_order_id=$1,updated_at=now() WHERE id=$2",
      [providerOrder.id, local.id]
    );
    res.status(201).json({
      status: "success",
      data: {
        gateway_order_id: local.id,
        order_id: data.order_id,
        provider_order_id: providerOrder.id,
        amount: data.amount,
        currency: "INR",
        checkout: { provider: "razorpay", key_id: process.env.RAZORPAY_KEY_ID, order_id: providerOrder.id }
      }
    });
  } catch (e) { next(e); }
});

app.get("/api/v1/orders/:orderId", requireApiKey, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT merchant_order_id AS order_id, amount_paise/100.0 AS amount, currency, status,
       provider_payment_id, created_at, updated_at
       FROM payment_orders WHERE merchant_id=$1 AND merchant_order_id=$2`,
      [req.merchantId, req.params.orderId]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Order not found" });
    res.json({ status: "success", data: result.rows[0] });
  } catch (e) { next(e); }
});

app.get("/api/transactions", requireUser, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT merchant_order_id AS order_id, amount_paise/100.0 AS amount, currency, status,
       provider_payment_id, created_at FROM payment_orders
       WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT 100`, [req.user.sub]);
    res.json({ data: result.rows });
  } catch (e) { next(e); }
});

app.use((err, _req, res, _next) => {
  if (err instanceof z.ZodError) return res.status(400).json({ error: "Invalid request", details: err.issues.map(i => ({ field: i.path.join("."), message: i.message })) });
  console.error("Request failed:", err.message);
  res.status(500).json({ error: "Internal server error" });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`FamUpiGateway starter listening on port ${port}`));
