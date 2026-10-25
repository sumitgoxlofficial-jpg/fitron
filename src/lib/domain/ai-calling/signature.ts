import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Proof that a request came from where it says. ElevenLabs signs its post-call webhooks: the header is "t=<unix seconds>,v0=<hex>",
// the hex being HMAC-SHA256 of "<t>.<raw body>" with the webhook's secret (ElevenLabs docs, "Post-call webhooks"). The check
// needs the body exactly as received, before anyone parses it.

export const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function verifyElevenSignature(rawBody: string, header: string | null, secret: string | undefined, nowMs = Date.now(), toleranceSec = 30 * 60): boolean {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => [p.slice(0, p.indexOf("=")).trim(), p.slice(p.indexOf("=") + 1).trim()]));
  const t = Number(parts.t);
  const v0 = parts.v0;
  if (!Number.isInteger(t) || !v0) return false;
  if (Math.abs(nowMs / 1000 - t) > toleranceSec) return false;
  return safeEqual(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"), v0);
}

/** For tests and local tools: builds a header the check above accepts */
export const signElevenBody = (rawBody: string, secret: string, nowMs = Date.now()) => {
  const t = Math.floor(nowMs / 1000);
  return `t=${t},v0=${createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex")}`;
};

/** The key one call's tools must present. Derived from the server secret and the call's id, so it can't be guessed or reused for another call. */
export const callToken = (secret: string, callId: string) => createHmac("sha256", secret).update(`call:${callId}`).digest("hex");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
