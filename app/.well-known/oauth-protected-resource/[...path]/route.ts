import { protectedResourceMetadata } from "@/lib/oauth";
import { canonicalOrigin, corsPreflight, publicJson } from "@/lib/oauth-http";

/**
 * The PATH-SUFFIXED form of the same document:
 * `/.well-known/oauth-protected-resource/api/mcp/mcp`.
 *
 * RFC 9728 §3.1 builds the URL by inserting the well-known segment before the
 * resource's path, and clients differ on which they try — claude.ai asks for
 * both. One document answers either, because this app protects exactly one
 * resource; serving a 404 on the suffixed form is a flow that dies before it
 * starts, which is a miserable thing to debug.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  return publicJson(protectedResourceMetadata(canonicalOrigin(req)));
}

export function OPTIONS(): Response {
  return corsPreflight();
}
