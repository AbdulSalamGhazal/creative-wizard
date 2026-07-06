import { NextResponse, type NextRequest } from "next/server";
import { verifySessionTokenEdge } from "@/lib/session-edge";

/**
 * Auth boundary for every route except sign-in, the public health check, and
 * static assets. The dashboard layout also checks auth, but Next.js documents
 * layouts as an unreliable security boundary (they don't re-run on every
 * nested navigation), so the middleware is the authoritative gate.
 *
 * Middleware runs on the Edge runtime, where `node:crypto` (used by
 * lib/auth-cookie.ts) is unavailable — so the HMAC check lives in
 * `lib/session-edge.ts` (`verifySessionTokenEdge`, Web Crypto) against the SAME
 * cookie format. `lib/session-edge.test.ts` pins it against auth-cookie's node
 * verifier so the two can't diverge on format, TTL, or secret handling.
 *
 * Deliberately thin: signature + TTL check only, no DB lookup. Role checks
 * and user existence stay in `auth()`/`requireAuth()` at the page/action layer.
 */

const SESSION_COOKIE = "ccms_session";

export async function middleware(req: NextRequest) {
  const secret = process.env.AUTH_SECRET;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  // Fail closed: no/short secret means nothing can be verified → everyone
  // is redirected to /signin (where sign-in itself will surface the misconfig).
  if (secret && secret.length >= 16 && (await verifySessionTokenEdge(token, secret))) {
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
  // (favicon, app icon, the public/*.svg files). `[^/]*\.svg$` matches only a
  // ROOT-level .svg filename — a nested path like /admin/export.svg still hits
  // auth (the old `.*\.svg$` exempted every .svg-suffixed path app-wide).
  matcher: [
    "/((?!_next/static|_next/image|signin|api/health|favicon.ico|icon.svg|[^/]*\\.svg$).*)",
  ],
};
