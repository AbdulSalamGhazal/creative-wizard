import { auth } from "@/lib/auth";
import { CONSENT_PATH } from "@/lib/oauth";
import {
  clientRedirect,
  readAuthorizeParams,
  resolveAuthorizeRequest,
} from "@/lib/oauth-authorize";
import { authorizeErrorPage, NO_STORE } from "@/lib/oauth-http";

/**
 * The authorization endpoint. A normal top-level browser navigation — NOT an API
 * call — so it deliberately carries no CORS headers: it acts on the user's
 * session, and no cross-origin script may read its result.
 *
 * Order matters and is the security model:
 *   1. Validate client_id + EXACT redirect_uri. A failure renders an error page
 *      and redirects NOWHERE (an open redirect here leaks authorization codes).
 *   2. Validate response_type and PKCE. Now that the redirect_uri is verified,
 *      these go back to the client as an error redirect with `state` echoed.
 *   3. Require a signed-in session. Without one, bounce to /signin with a
 *      `next` that returns here — the request survives the sign-in.
 *   4. Hand off to the consent screen, which is the app's own UI.
 *
 * `/api/oauth` is excluded from middleware.ts: the cookie gate answers an /api/
 * path with a 401 JSON, which would turn a browser sign-in into a dead end.
 * Step 3 is this route's own gate.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const params = readAuthorizeParams(url);
  const check = await resolveAuthorizeRequest(params);

  if (check.kind === "page_error") {
    return authorizeErrorPage(check.title, check.detail);
  }
  if (check.kind === "redirect_error") {
    return Response.redirect(
      clientRedirect(
        params.redirectUri,
        { error: check.error, error_description: check.description },
        params.state,
      ),
      302,
    );
  }

  // Signed in? The query is preserved verbatim so nothing is lost or reordered.
  const user = await auth();
  const selfPath = `${url.pathname}${url.search}`;
  if (!user) {
    const signin = new URL("/signin", url.origin);
    signin.searchParams.set("next", selfPath);
    return redirectTo(signin.toString());
  }

  const consent = new URL(CONSENT_PATH, url.origin);
  consent.search = url.search;
  return redirectTo(consent.toString());
}

/**
 * `Response.redirect` cannot carry extra headers, and an authorization redirect
 * must not be cached — a cached hop would send the next person through a stale
 * consent request.
 */
function redirectTo(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location, ...NO_STORE } });
}
