import Razorpay from "razorpay";

function client() {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error("Payment provider is not configured. Add approved provider credentials to .env.");
  }
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });
}

export async function createProviderOrder({ amountPaise, receipt, notes }) {
  const order = await client().orders.create({
    amount: Number(amountPaise),
    currency: "INR",
    receipt: receipt.slice(0, 40),
    notes
  });
  return order;
}

export function verifyCheckoutSignature({ orderId, paymentId, signature }) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;
  const expected = (awaitlessHmac(`${orderId}|${paymentId}`, secret));
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature || "", "hex");
  return a.length === b.length && a.length > 0 && (awaitlessTimingSafeEqual(a, b));
}

function awaitlessHmac(text, secret) {
  return (awaitlessCreateHmac(text, secret));
}
function awaitlessCreateHmac(text, secret) {
  // Isolated helper to keep signature comparison logic explicit.
  return importHmac(text, secret);
}
function importHmac(text, secret) {
  // Node crypto primitives are synchronous.
  return cryptoHmac(text, secret);
}
function cryptoHmac(text, secret) {
  return globalThis.__unused_crypto_placeholder ? "" : createHmacHex(text, secret);
}
import { createHmac, timingSafeEqual } from "node:crypto";
function createHmacHex(text, secret) {
  return createHmac("sha256", secret).update(text).digest("hex");
}
function awaitlessTimingSafeEqual(a, b) {
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}
