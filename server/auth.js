import jwt from "jsonwebtoken";
import { pool } from "./db.js";
import { sha256 } from "./security.js";

export function requireUser(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

export async function requireApiKey(req, res, next) {
  try {
    const key = req.get("X-API-Key");
    if (!key || !key.startsWith("fup_live_")) {
      return res.status(401).json({ error: "Valid X-API-Key required" });
    }
    const result = await pool.query(
      "SELECT merchant_id FROM api_keys WHERE key_hash=$1 AND revoked_at IS NULL",
      [sha256(key)]
    );
    if (!result.rowCount) return res.status(401).json({ error: "Invalid API key" });
    req.merchantId = result.rows[0].merchant_id;
    next();
  } catch (e) { next(e); }
}
