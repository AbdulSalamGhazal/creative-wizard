import { authorizationServerMetadata } from "@/lib/oauth";
import { canonicalOrigin, corsPreflight, publicJson } from "@/lib/oauth-http";

/**
 * RFC 8414 authorization-server metadata. The `issuer` MUST equal the origin the
 * client fetched this from, or the client rejects the document — which is why
 * every URL here is built from one `canonicalOrigin()` call.
 *
 * S256 is the only `code_challenge_method` advertised (no `plain`), and the only
 * grants are `authorization_code` + `refresh_token`: no implicit, no password.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  return publicJson(authorizationServerMetadata(canonicalOrigin(req)));
}

export function OPTIONS(): Response {
  return corsPreflight();
}
