import { canonicalOrigin, type OauthErrorCode } from "@/lib/oauth";

/**
 * HTTP shapes shared by the OAuth endpoints: CORS, cache headers and the error
 * envelope. Kept out of `lib/oauth.ts` so that module stays pure-ish logic that
 * tests can call without constructing Requests.
 *
 * CORS IS PERMISSIVE AND THAT IS CORRECT HERE — but only on the three endpoints
 * that are public, cookie-free and carry no ambient authority: discovery,
 * registration and the token exchange. A browser-based client fetches those
 * cross-origin, nothing in them acts on a session cookie, and every secret they
 * take is something the caller already has. `/api/oauth/authorize` is a normal
 * top-level navigation, so it gets NO CORS headers at all: it DOES act on the
 * user's session, and a cross-origin script must never be able to read it.
 */

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

/** Tokens and metadata must never sit in a shared cache. */
export const NO_STORE: Record<string, string> = { "Cache-Control": "no-store" };

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** A public JSON document (discovery): CORS + a short cache. */
export function publicJson(body: unknown): Response {
  return Response.json(body, {
    headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=3600" },
  });
}

/** RFC 6749 §5.2 error body. `invalid_client` is the one that gets a 401. */
export function oauthError(
  error: OauthErrorCode,
  description: string,
  status?: number,
): Response {
  return Response.json(
    { error, error_description: description },
    {
      status: status ?? (error === "invalid_client" ? 401 : 400),
      headers: { ...CORS_HEADERS, ...NO_STORE },
    },
  );
}

/**
 * Read a request body as parameters, accepting BOTH form encoding (what the RFC
 * specifies and most clients send) and JSON (what some send anyway). Returning
 * one shape keeps the handlers from caring.
 */
export async function readParams(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  const out: Record<string, string> = {};
  if (type.includes("application/json")) {
    try {
      const parsed: unknown = await req.json();
      if (parsed && typeof parsed === "object") {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === "string") out[k] = v;
        }
      }
    } catch {
      /* a malformed body is an absent body — the handler reports what's missing */
    }
    return out;
  }
  try {
    const form = await req.formData();
    for (const [k, v] of form.entries()) if (typeof v === "string") out[k] = v;
  } catch {
    /* same */
  }
  return out;
}

/**
 * A standalone HTML page for the one case that must NOT redirect: a client_id or
 * redirect_uri we cannot verify. Self-contained (no app shell, no session) and
 * styled inline, because the whole point is that we refuse to hand control back
 * to whoever sent the request.
 */
export function authorizeErrorPage(title: string, detail: string, status = 400): Response {
  const esc = (s: string) =>
    s.replace(/[&<>"']/g, (c) =>
      c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
    );
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  :root { color-scheme: dark light; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         background:#0b0b0f; color:#e8e8ee; font:15px/1.5 ui-sans-serif,system-ui,sans-serif; padding:24px; }
  main { max-width:30rem; border:1px solid #26263a; border-radius:12px; background:#13131c; padding:20px 22px; }
  h1 { margin:0 0 .5rem; font-size:1rem; }
  p { margin:0 0 .75rem; color:#a9a9bd; }
  code { font-family:ui-monospace,monospace; font-size:.85em; color:#e8e8ee; }
</style></head>
<body><main>
  <h1>${esc(title)}</h1>
  <p>${esc(detail)}</p>
  <p>Nothing was shared, and you have not been redirected anywhere. If you were
  connecting an app, start the connection again from that app.</p>
</main></body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE },
  });
}

/** The origin for this request — re-exported so routes import one module. */
export { canonicalOrigin };
