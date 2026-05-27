/**
 * Cookie-based session helpers. Backs the open-by-email auth model: any
 * user that has been added via /admin/users can sign in by typing their
 * email — no password, no Google verification (PRD trade-off recorded in
 * BUILDLOG). Intended for an internal trusted-team tool; if the dashboard
 * ever leaves the office network, add a password or OAuth on top.
 *
 * Cookie shape: `<userId>.<hmac-sha256(userId)>` (base64url). The HMAC stops
 * an attacker from forging a session by writing a userId into their cookie.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "ccms_session";
export const SESSION_TTL_DAYS = 30;

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
  const sig = createHmac("sha256", getSecret()).update(userId).digest();
  return `${userId}.${b64url(sig)}`;
}

export function verifySessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!userId || !sig) return null;
  const expected = createHmac("sha256", getSecret()).update(userId).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;
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
