/**
 * Cookie-based session helpers for the internal email + password auth model
 * (users are created via /admin/users; sign-in verifies a bcrypt password).
 *
 * Cookie shape: `<userId>.<issuedAtMs>.<hmac-sha256(userId.issuedAtMs)>`
 * (base64url sig). The HMAC stops forgery, and the signed issued-at timestamp
 * gives a server-enforced expiry — a copied/old cookie stops working after
 * SESSION_TTL_DAYS regardless of the client-side maxAge.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "ccms_session";
export const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "AUTH_SECRET is not set (or is too short). Set it to a random 32+ char string in .env.local.",
    );
  }
  return secret;
}

function b64url(input: Buffer): string {
  return input.toString("base64url");
}

function sign(userId: string): string {
  const payload = `${userId}.${Date.now()}`;
  const sig = createHmac("sha256", getSecret()).update(payload).digest();
  return `${payload}.${b64url(sig)}`;
}

export function verifySessionToken(token: string | undefined): string | null {
  if (!token) return null;
  // token = "<userId>.<issuedAtMs>.<sig>"; userId is a UUID (no dots), so the
  // last dot separates the signature and the one before it separates issuedAt.
  const lastDot = token.lastIndexOf(".");
  if (lastDot <= 0) return null;
  const payload = token.slice(0, lastDot); // "<userId>.<issuedAtMs>"
  const sig = token.slice(lastDot + 1);
  if (!payload || !sig) return null;

  const expected = createHmac("sha256", getSecret()).update(payload).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  const sep = payload.lastIndexOf(".");
  if (sep <= 0) return null;
  const userId = payload.slice(0, sep);
  const issuedAt = Number(payload.slice(sep + 1));
  if (!userId || !Number.isFinite(issuedAt)) return null;

  const age = Date.now() - issuedAt;
  if (age > SESSION_TTL_MS) return null; // expired
  if (age < -60_000) return null; // issued in the future — reject (clock skew guard)
  return userId;
}

export async function setSessionCookie(userId: string): Promise<void> {
  const jar = await cookies();
  jar.set({
    name: SESSION_COOKIE,
    value: sign(userId),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function readSessionUserId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return verifySessionToken(token);
}
