import { NextResponse, type NextRequest } from "next/server";
import { verifySessionTokenEdge } from "@/lib/session-edge";
import { REQUEST_PATH_HEADER, signinHref } from "@/lib/signin-redirect";
import {
  ANY_BRAND,
  BRAND_HEADER,
  LAST_BRAND_COOKIE,
  classifyPath,
  isBrandSlug,
  splitBrandPath,
} from "@/lib/brand-path";

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
 *
 * `/api/mcp` is EXCLUDED from this gate (like `/api/health`): the MCP server has
 * its OWN auth — a bearer token (personal `cwz_` key or an OAuth access token)
 * verified in the route handler — and receives no session cookie. The exclusion
 * is in the matcher below; it does NOT widen the web app's cookie protection.
 *
 * `/api/oauth` and `/.well-known` are excluded for the same kind of reason, and
 * each endpoint there states its own rule: registration, token and the discovery
 * documents are PUBLIC and cookie-free (an OAuth client calls them before any
 * user is involved), while `/api/oauth/authorize` DOES need a session and checks
 * for one itself — it must bounce a signed-out visitor to /signin, and this gate
 * answers an /api/ path with a 401 JSON, which would end a browser sign-in flow
 * in a blank error instead of a login form. The consent screen (`/oauth/consent`)
 * is NOT excluded: it is ordinary app UI behind the normal cookie gate.
 */

const SESSION_COOKIE = "ccms_session";

export async function middleware(req: NextRequest) {
  const secret = process.env.AUTH_SECRET;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  // Fail closed: no/short secret means nothing can be verified → everyone
  // is redirected to /signin (where sign-in itself will surface the misconfig).
  const { pathname, search } = req.nextUrl;
  if (secret && secret.length >= 16 && (await verifySessionTokenEdge(token, secret))) {
    // Hand the page the path it serves, so a layout that still refuses this
    // session (a removed user, ended sessions) can send the person back here
    // after sign-in. Set, never appended: a client's own value is replaced.
    const kind = classifyPath(pathname);

    // THE BRAND IS IN THE URL (2026-11, lib/brand-path.ts). An unprefixed
    // dashboard path — an old bookmark, a link from before the change, the
    // bare domain — goes to the brand this browser was last on (`_` = the
    // layout picks). Only a page load: a stale tab's action POST is left to
    // fail and offer Reload, never silently re-aimed at another brand.
    if (kind === "legacy" && (req.method === "GET" || req.method === "HEAD")) {
      const last = req.cookies.get(LAST_BRAND_COOKIE)?.value;
      const slug = isBrandSlug(last) ? last : ANY_BRAND;
      const to = req.nextUrl.clone();
      to.pathname = `/${slug}${pathname === "/" ? "" : pathname}`;
      return NextResponse.redirect(to);
    }

    const headers = new Headers(req.headers);
    headers.set(REQUEST_PATH_HEADER, pathname + search);
    if (kind === "branded") {
      // The URL's brand, for `getActiveAccountId()` — set, never appended,
      // so a client can't name a different one than its address bar.
      headers.set(BRAND_HEADER, splitBrandPath(pathname).slug!);
    } else if (!pathname.startsWith("/api/")) {
      // Only an API call may carry a brand of its own (`brandFetch`).
      headers.delete(BRAND_HEADER);
    }
    return NextResponse.next({ request: { headers } });
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL(signinHref(pathname + search), req.url));
}

export const config = {
  // Everything EXCEPT: Next internals/static, the sign-in page (and its server
  // action POST), the public health check, and ROOT-level static assets — the
  // tab icon (`app/icon.png`, served at /icon.png), the logo (`public/logo.png`,
  // which the SIGN-IN page itself shows) and the other `public/` files.
  // `[^/]*\.svg$` (and .png, .ico) matches only a ROOT-level filename — a nested
  // path like /admin/export.svg or /dev-uploads/avatars/x.png still hits auth
  // (the old `.*\.svg$` exempted every .svg-suffixed path app-wide). Pinned by
  // `middleware.test.ts`, which checks every file in `public/` and `app/icon.*`:
  // this list once named `icon.svg` long after the icon became a png, so the
  // sign-in page's own logo redirected a signed-out visitor to /signin.
  matcher: [
    "/((?!_next/static|_next/image|signin|api/health|api/mcp|api/oauth|\\.well-known|[^/]*\\.svg$|[^/]*\\.png$|[^/]*\\.ico$).*)",
  ],
};
