import { createMcpHandler } from "mcp-handler";
import { verifyApiToken } from "@/lib/api-token";
import { ACCESS_TOKEN_PREFIX, verifyAccessToken, wwwAuthenticateHeader } from "@/lib/oauth";
import { canonicalOrigin } from "@/lib/oauth-http";
import { registerMcpTools } from "@/lib/mcp/tools";
import { runWithMcpActor, rateLimitOk } from "@/lib/mcp/runtime";
import type { SessionUser } from "@/lib/auth";

/** Either auth path produces the same thing: a user plus a rate-limit key. */
interface McpActor {
  user: SessionUser;
  tokenId: string;
}

/**
 * Remote MCP server (Streamable HTTP) — lets each user connect their own LLM
 * (Claude Desktop/Code, Cursor, ChatGPT dev-mode, SDKs) to READ-ONLY Wizard
 * analytics. Auth is a per-user personal access token (`Authorization: Bearer
 * cwz_…`), NOT the session cookie — so `middleware.ts` excludes `/api/mcp` from
 * the cookie gate; this handler is the boundary. The token acts as its owner:
 * brand membership + read access apply exactly as in the web app.
 *
 * DUAL AUTH since 2026-10: the bearer may be a personal `cwz_` token OR an
 * OAuth 2.1 access token (`cwz_at_…`) from the browser sign-in flow
 * (`lib/oauth.ts`). Both resolve to a USER and the request runs as them — one
 * identity model, two ways of proving it. Every 401 carries
 * `WWW-Authenticate: Bearer resource_metadata="…"`, which is what makes a client
 * discover the authorization server (RFC 9728) and, for an expired token,
 * refresh silently instead of asking the user to reconnect.
 *
 * v1 is strictly read-only. See lib/mcp/tools.ts for the tool set.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const mcpHandler = createMcpHandler(
  (server) => registerMcpTools(server),
  {},
  { basePath: "/api/mcp", maxDuration: 60 },
);

function unauthorized(req: Request): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message:
          "Unauthorized: sign in to connect, or present a valid personal access token.",
      },
      id: null,
    },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": wwwAuthenticateHeader(canonicalOrigin(req), "invalid_token"),
      },
    },
  );
}

/**
 * Resolve the bearer to an acting user. Routed by PREFIX rather than by trying
 * both: `cwz_at_` is an OAuth access token, anything else `cwz_` is a personal
 * token — so a revoked token of one kind can never be looked up as the other.
 */
async function authenticate(req: Request): Promise<McpActor | null> {
  const header = req.headers.get("authorization");
  const raw = (header ?? "").replace(/^Bearer\s+/i, "").trim();
  if (raw.startsWith(ACCESS_TOKEN_PREFIX)) {
    const actor = await verifyAccessToken(header);
    return actor ? { user: actor.user, tokenId: actor.tokenId } : null;
  }
  return verifyApiToken(header);
}

function rateLimited(): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      error: { code: -32005, message: "Rate limit exceeded (60 calls/min). Slow down." },
      id: null,
    },
    { status: 429, headers: { "Retry-After": "60" } },
  );
}

/** Bearer-authenticate, rate-limit, then run the MCP handler as the token owner. */
async function handle(req: Request): Promise<Response> {
  const actor = await authenticate(req);
  if (!actor) return unauthorized(req);
  if (!rateLimitOk(actor.tokenId)) return rateLimited();
  return runWithMcpActor(actor, () => mcpHandler(req));
}

export { handle as GET, handle as POST, handle as DELETE };
