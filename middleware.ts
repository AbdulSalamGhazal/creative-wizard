import { NextResponse, type NextRequest } from "next/server";

/**
 * Auth boundary for every route except sign-in, the public health check, and
 * static assets. The dashboard layout also checks auth, but Next.js documents
 * layouts as an unreliable security boundary (they don't re-run on every
 * nested navigation), so the middleware is the authoritative gate.
 *
 * Middleware runs on the Edge runtime, where `node:crypto` (used by
 * lib/auth-cookie.ts) is unavailable — so the HMAC check is re-implemented
 * here with Web Crypto against the SAME cookie format:
 * `<userId>.<issuedAtMs>.<base64url hmac-sha256(userId.issuedAtMs)>`.
 * Keep the constants and parsing in sync with lib/auth-cookie.ts; the cookie
 * format itself must not change (that would log every user out).
 *
 * Deliberately thin: signature + TTL check only, no DB lookup. Role checks
 * and user existence stay in `auth()`/`requireAuth()` at the page/action layer.
 */

const SESSION_COOKIE = "ccms_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // = SESSION_TTL_DAYS in lib/auth-cookie.ts

async function hasValidSession(
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

export async function middleware(req: NextRequest) {
  const secret = process.env.AUTH_SECRET;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  // Fail closed: no/short secret means nothing can be verified → everyone
  // is redirected to /signin (where sign-in itself will surface the misconfig).
  if (secret && secret.length >= 16 && (await hasValidSession(token, secret))) {
    return NextResponse.next();
  }

  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const signin = new URL("/signin", req.url);
  const next = pathname + search;
  if (next && next !== "/") signin.searchParams.set("next", next);
  return NextResponse.redirect(signin);
}

export const config = {
  // Everything EXCEPT: Next internals/static, the sign-in page (and its server
  // action POST), the public health check, and root-level static assets
  // (favicon, app icon, the public/*.svg files).
  matcher: [
    "/((?!_next/static|_next/image|signin|api/health|favicon.ico|icon.svg|.*\\.svg$).*)",
  ],
};
