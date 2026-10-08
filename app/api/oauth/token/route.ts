import {
  exchangeAuthorizationCode,
  refreshTokenGrant,
  type GrantResult,
} from "@/lib/oauth";
import {
  CORS_HEADERS,
  NO_STORE,
  corsPreflight,
  oauthError,
  readParams,
} from "@/lib/oauth-http";

/**
 * The token endpoint — both grants, nothing else.
 *
 * Public and cookie-free (the client authenticates with its own credentials, or
 * with PKCE alone), so permissive CORS is correct here: a browser-based client
 * must be able to call it, and nothing in it acts on ambient authority.
 *
 * `Cache-Control: no-store` on every response, success or failure. The security
 * logic itself lives in lib/oauth.ts: atomic single-use codes, PKCE S256,
 * rotation, and family revocation on reuse.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const p = await readParams(req);
  const grantType = p.grant_type ?? "";

  let result: GrantResult;
  if (grantType === "authorization_code") {
    result = await exchangeAuthorizationCode({
      code: p.code ?? "",
      clientId: p.client_id ?? "",
      redirectUri: p.redirect_uri ?? "",
      codeVerifier: p.code_verifier ?? "",
      clientSecret: p.client_secret ?? null,
    });
  } else if (grantType === "refresh_token") {
    result = await refreshTokenGrant({
      refreshToken: p.refresh_token ?? "",
      clientId: p.client_id ?? "",
      clientSecret: p.client_secret ?? null,
    });
  } else {
    return oauthError(
      "unsupported_grant_type",
      "Supported grant_type values: authorization_code, refresh_token.",
    );
  }

  if (!result.ok) return oauthError(result.error, result.description);

  return Response.json(
    {
      access_token: result.accessToken,
      token_type: "Bearer",
      expires_in: result.expiresIn,
      refresh_token: result.refreshToken,
      scope: result.scope,
    },
    { headers: { ...CORS_HEADERS, ...NO_STORE } },
  );
}

export function OPTIONS(): Response {
  return corsPreflight();
}
