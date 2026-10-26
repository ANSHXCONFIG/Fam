import crypto from "node:crypto";

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
export function safeEqualHex(a, b) {
  const aa = Buffer.from(a || "", "hex");
  const bb = Buffer.from(b || "", "hex");
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
}
export function newApiKey() {
  return "fup_live_" + crypto.randomBytes(32).toString("hex");
}
