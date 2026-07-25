import { createMcpHandler } from "mcp-handler";
import { verifyApiToken } from "@/lib/api-token";
import { registerMcpTools } from "@/lib/mcp/tools";
import { runWithMcpActor, rateLimitOk } from "@/lib/mcp/runtime";

/**
 * Remote MCP server (Streamable HTTP) — lets each user connect their own LLM
 * (Claude Desktop/Code, Cursor, ChatGPT dev-mode, SDKs) to READ-ONLY Wizard
 * analytics. Auth is a per-user personal access token (`Authorization: Bearer
 * cwz_…`), NOT the session cookie — so `middleware.ts` excludes `/api/mcp` from
 * the cookie gate; this handler is the boundary. The token acts as its owner:
 * brand membership + read access apply exactly as in the web app.
 *
 * v1 is strictly read-only. OAuth 2.1 for claude.ai-web/ChatGPT-web connectors
 * is out of scope (Phase 2). See lib/mcp/tools.ts for the tool set.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const mcpHandler = createMcpHandler(
  (server) => registerMcpTools(server),
  {},
  { basePath: "/api/mcp", maxDuration: 60 },
);

function unauthorized(): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized: missing, invalid, or revoked API token." },
      id: null,
    },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="Wizard MCP"' } },
  );
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
  const actor = await verifyApiToken(req.headers.get("authorization"));
  if (!actor) return unauthorized();
  if (!rateLimitOk(actor.tokenId)) return rateLimited();
  return runWithMcpActor(actor, () => mcpHandler(req));
}

export { handle as GET, handle as POST, handle as DELETE };
