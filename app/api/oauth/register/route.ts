import { z } from "zod";
import {
  isRegisterableRedirectUri,
  registerClient,
  type TokenEndpointAuthMethod,
} from "@/lib/oauth";
import { CORS_HEADERS, NO_STORE, corsPreflight, readParams } from "@/lib/oauth-http";

/**
 * RFC 7591 dynamic client registration — how claude.ai gets a `client_id`
 * without anyone filling in a form. OPEN registration (no auth), which is what
 * the MCP connector flow requires; a registered client is powerless on its own:
 * it can only ask a signed-in user for consent, and a user who refuses gives it
 * nothing.
 *
 * THE ONE RULE WORTH GUARDING IS `redirect_uris`: https, absolute, no fragment,
 * no wildcard, stored and later matched EXACTLY. Loopback `http://localhost`
 * callbacks (mcp-remote, Claude Desktop) are refused on purpose — those clients
 * keep using a personal `cwz_` token, which is why dual auth stays.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  client_name: z.string().trim().min(1).max(120).optional(),
  redirect_uris: z.array(z.string()).min(1).max(10),
  token_endpoint_auth_method: z.enum(["none", "client_secret_post"]).optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
});

/** RFC 7591 §3.2.2 error shape — a different vocabulary from the token endpoint's. */
function registrationError(error: string, description: string, status = 400): Response {
  return Response.json(
    { error, error_description: description },
    { status, headers: { ...CORS_HEADERS, ...NO_STORE } },
  );
}

export async function POST(req: Request): Promise<Response> {
  const raw = await readJsonOrForm(req);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return registrationError(
      "invalid_client_metadata",
      "redirect_uris is required and must be an array of absolute https URLs.",
    );
  }

  const uris = parsed.data.redirect_uris;
  const bad = uris.filter((u) => !isRegisterableRedirectUri(u));
  if (bad.length > 0) {
    return registrationError(
      "invalid_redirect_uri",
      `Every redirect_uri must be an absolute https URL with no fragment and no wildcard. Rejected: ${bad.join(", ")}`,
    );
  }

  // Unsupported grants are refused rather than silently narrowed: a client that
  // asked for `implicit` should hear "no", not discover it later.
  const grants = parsed.data.grant_types;
  if (grants && grants.some((g) => g !== "authorization_code" && g !== "refresh_token")) {
    return registrationError(
      "invalid_client_metadata",
      "Only the authorization_code and refresh_token grants are supported.",
    );
  }

  const method: TokenEndpointAuthMethod = parsed.data.token_endpoint_auth_method ?? "none";
  const client = await registerClient({
    clientName: parsed.data.client_name ?? "Unnamed client",
    redirectUris: uris,
    tokenEndpointAuthMethod: method,
  });

  return Response.json(
    {
      client_id: client.clientId,
      ...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: client.tokenEndpointAuthMethod,
    },
    { status: 201, headers: { ...CORS_HEADERS, ...NO_STORE } },
  );
}

export function OPTIONS(): Response {
  return corsPreflight();
}

/**
 * Registration metadata is JSON per the RFC, but arrays can't survive the form
 * encoding `readParams` handles — so JSON is parsed natively here and form data
 * is accepted only as a fallback for the scalar fields.
 */
async function readJsonOrForm(req: Request): Promise<unknown> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    try {
      return await req.json();
    } catch {
      return null;
    }
  }
  const params = await readParams(req);
  return {
    ...params,
    redirect_uris: params.redirect_uris ? [params.redirect_uris] : undefined,
  };
}
