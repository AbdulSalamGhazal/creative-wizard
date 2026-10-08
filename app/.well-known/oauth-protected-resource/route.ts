import { protectedResourceMetadata } from "@/lib/oauth";
import { canonicalOrigin, corsPreflight, publicJson } from "@/lib/oauth-http";

/**
 * RFC 9728 protected-resource metadata — the document a 401 from
 * `/api/mcp/mcp` points at via `WWW-Authenticate: …resource_metadata="…"`.
 * It tells the client which authorization server to use; everything else in the
 * flow is discovered from there.
 *
 * Public and cookie-free by design (it says nothing a client doesn't need to
 * know to start a sign-in), so it answers cross-origin requests.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  return publicJson(protectedResourceMetadata(canonicalOrigin(req)));
}

export function OPTIONS(): Response {
  return corsPreflight();
}
