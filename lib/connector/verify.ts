import { createHmac } from "node:crypto";
import { timingSafeEqualHex } from "@/lib/crypto";

/** A batch older (or newer) than this is refused — the connector's own rule. */
export const SIGNATURE_WINDOW_SECONDS = 300;

/**
 * Verify a connector webhook: `X-Signature` is `sha256=` + the hex
 * HMAC-SHA256 of `"<X-Timestamp>.<raw body>"`, keyed with the signing secret.
 * Computed over the RAW body (before any JSON parse) and compared in constant
 * time. `nowMs` is a parameter so the window is testable.
 */
export function verifyConnectorSignature(input: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  secret: string;
  nowMs?: number;
}): boolean {
  const { rawBody, timestamp, signature, secret } = input;
  if (!timestamp || !signature || !secret) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  const now = (input.nowMs ?? Date.now()) / 1000;
  if (Math.abs(now - Number(timestamp)) > SIGNATURE_WINDOW_SECONDS) return false;
  if (!signature.startsWith("sha256=")) return false;
  const given = signature.slice("sha256=".length);
  if (!/^[0-9a-f]{64}$/i.test(given)) return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return timingSafeEqualHex(given.toLowerCase(), expected);
}

/** Sign a body the way the connector does — tests and the local smoke check. */
export function signConnectorBody(rawBody: string, timestamp: string, secret: string): string {
  return (
    "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")
  );
}
