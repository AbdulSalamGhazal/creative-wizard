/**
 * Edge-runtime session verification (Web Crypto), the counterpart to the
 * node:crypto `verifySessionToken` in `lib/auth-cookie.ts`. Both check the SAME
 * cookie format — `<userId>.<issuedAtMs>.<base64url hmac-sha256(userId.issuedAtMs)>` —
 * and the SAME 30-day TTL; they exist as two implementations only because
 * middleware runs on the Edge runtime where `node:crypto` is unavailable.
 *
 * `lib/session-edge.test.ts` pins the two against each other so they can't
 * silently diverge on format, TTL, or secret handling. Keep this in lock-step
 * with `lib/auth-cookie.ts` — changing the format logs every user out.
 */

// = SESSION_TTL_DAYS (30) in lib/auth-cookie.ts.
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * True iff `token` is a well-formed, correctly-signed, in-TTL session token for
 * `secret`. Signature + TTL only — no DB lookup (that stays in `auth()`).
 */
export async function verifySessionTokenEdge(
  token: string | undefined,
  secret: string,
): Promise<boolean> {
  if (!token) return false;
  const lastDot = token.lastIndexOf(".");
  if (lastDot <= 0) return false;
  const payload = token.slice(0, lastDot); // "<userId>.<issuedAtMs>"
  const sigB64 = token.slice(lastDot + 1);
  if (!payload || !sigB64) return false;

  // Built with an explicit ArrayBuffer so TS accepts it as a BufferSource
  // (Uint8Array.from is typed over ArrayBufferLike, which subtle.verify rejects).
  let sig: Uint8Array<ArrayBuffer>;
  try {
    const b64 = sigB64.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    sig = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) sig[i] = bin.charCodeAt(i);
  } catch {
    return false;
  }

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  // subtle.verify is constant-time and handles length mismatches internally.
  const ok = await crypto.subtle.verify("HMAC", key, sig, enc.encode(payload));
  if (!ok) return false;

  const sep = payload.lastIndexOf(".");
  if (sep <= 0) return false;
  const issuedAt = Number(payload.slice(sep + 1));
  if (!Number.isFinite(issuedAt)) return false;
  const age = Date.now() - issuedAt;
  if (age > SESSION_TTL_MS) return false; // expired
  if (age < -60_000) return false; // issued in the future — clock-skew guard
  return true;
}
