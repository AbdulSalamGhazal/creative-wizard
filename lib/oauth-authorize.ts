import {
  DEFAULT_SCOPE,
  findClient,
  isAllowedRedirectUri,
  type OauthClientRow,
} from "@/lib/oauth";

/**
 * Validation of an authorization REQUEST, shared by the `/api/oauth/authorize`
 * route and the consent page it hands off to. Both must agree exactly: the page
 * re-validates from the URL rather than trusting that the route already did,
 * because a consent screen is reachable by typing its address.
 *
 * THE TWO-PHASE RULE (RFC 6749 §4.1.2.1) is the reason this returns a union
 * rather than throwing:
 *   - Until client_id AND redirect_uri are verified, there is NOWHERE safe to
 *     send the user. Those failures render an error page. Redirecting on an
 *     unverified redirect_uri is an open redirect, and an open redirect on an
 *     authorization endpoint is a credential leak.
 *   - After they verify, every other problem goes BACK to the client as an
 *     error redirect, with `state` echoed untouched.
 */

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  responseType: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string | null;
  scope: string | null;
  resource: string | null;
}

/** Read the query exactly as it arrived — no defaulting of security-relevant parts. */
export function readAuthorizeParams(url: URL): AuthorizeParams {
  const q = url.searchParams;
  return {
    clientId: q.get("client_id") ?? "",
    redirectUri: q.get("redirect_uri") ?? "",
    responseType: q.get("response_type") ?? "",
    codeChallenge: q.get("code_challenge") ?? "",
    codeChallengeMethod: q.get("code_challenge_method") ?? "",
    state: q.get("state"),
    scope: q.get("scope"),
    resource: q.get("resource"),
  };
}

export type AuthorizeCheck =
  /** Nothing may be redirected. Render a page. */
  | { kind: "page_error"; title: string; detail: string }
  /** Safe to tell the client, because the redirect_uri is verified. */
  | { kind: "redirect_error"; error: string; description: string; client: OauthClientRow }
  | { kind: "ok"; client: OauthClientRow; scope: string };

export function checkAuthorizeRequest(
  params: AuthorizeParams,
  client: OauthClientRow | null,
): AuthorizeCheck {
  // ---- Phase 1: who is asking, and where may they be sent back to? ----
  if (!params.clientId) {
    return {
      kind: "page_error",
      title: "Missing client",
      detail: "This authorization request has no client_id.",
    };
  }
  if (!client) {
    return {
      kind: "page_error",
      title: "Unknown app",
      detail: "No application is registered with that client_id.",
    };
  }
  if (!params.redirectUri) {
    return {
      kind: "page_error",
      title: "Missing redirect",
      detail: "This authorization request has no redirect_uri.",
    };
  }
  if (!isAllowedRedirectUri(client, params.redirectUri)) {
    return {
      kind: "page_error",
      title: "Redirect address does not match",
      detail:
        `“${client.clientName}” asked to be sent back to an address it has not registered. ` +
        `For safety the request stops here.`,
    };
  }

  // ---- Phase 2: the client is verified, so errors can go home ----
  if (params.responseType !== "code") {
    return {
      kind: "redirect_error",
      error: "unsupported_response_type",
      description: "Only response_type=code is supported.",
      client,
    };
  }
  if (!params.codeChallenge) {
    return {
      kind: "redirect_error",
      error: "invalid_request",
      description: "PKCE is required: send code_challenge with code_challenge_method=S256.",
      client,
    };
  }
  if (params.codeChallengeMethod !== "S256") {
    return {
      kind: "redirect_error",
      error: "invalid_request",
      description: "code_challenge_method must be S256.",
      client,
    };
  }
  // A client may ask for a narrower scope than we have; there is only one, so
  // anything else is a mistake worth naming rather than silently granting.
  const requested = (params.scope ?? "").trim();
  if (requested && requested !== DEFAULT_SCOPE) {
    return {
      kind: "redirect_error",
      error: "invalid_scope",
      description: `The only supported scope is ${DEFAULT_SCOPE}.`,
      client,
    };
  }
  return { kind: "ok", client, scope: DEFAULT_SCOPE };
}

/** Look the client up and validate in one call — what both surfaces actually want. */
export async function resolveAuthorizeRequest(
  params: AuthorizeParams,
): Promise<AuthorizeCheck> {
  const client = params.clientId ? await findClient(params.clientId) : null;
  return checkAuthorizeRequest(params, client);
}

/**
 * Build a redirect back to the client. `state` is echoed EXACTLY as received —
 * it is the client's CSRF token and we are not its interpreter.
 */
export function clientRedirect(
  redirectUri: string,
  fields: Record<string, string>,
  state: string | null,
): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(fields)) url.searchParams.set(k, v);
  if (state !== null) url.searchParams.set("state", state);
  return url.toString();
}
