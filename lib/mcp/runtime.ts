import { AsyncLocalStorage } from "node:async_hooks";
import type { SessionUser } from "@/lib/auth";
import {
  allowedAccountsForUser,
  runWithTenant,
  type Account,
} from "@/lib/tenant";

/**
 * Shared runtime for the read-only MCP tools (`app/api/mcp/[transport]/route.ts`).
 *
 * The route authenticates the bearer token ONCE per request and stashes the
 * acting user here (an AsyncLocalStorage, so it survives the awaits inside the
 * MCP SDK). Each tool then resolves the `brand` argument against that user's
 * allowed brands and runs its query inside `runWithTenant` — so brand
 * membership and read scope apply exactly as in the web app. NOTHING here (or in
 * any tool) mutates data: v1 is strictly read-only.
 */

interface McpActor {
  user: SessionUser;
  tokenId: string;
}

const actorStore = new AsyncLocalStorage<McpActor>();

/** Run `fn` with the authed token owner on the async call stack. */
export function runWithMcpActor<T>(actor: McpActor, fn: () => Promise<T>): Promise<T> {
  return actorStore.run(actor, fn);
}

/** The token owner for the current request. Throws if called outside auth. */
export function currentActor(): McpActor {
  const a = actorStore.getStore();
  if (!a) throw new Error("MCP tool ran without an authenticated actor");
  return a;
}

// ---- Per-token rate limit (in-memory per instance; acceptable for v1) --------

const RATE_LIMIT = 60; // calls
const RATE_WINDOW_MS = 60_000; // per minute
const hits = new Map<string, number[]>();

/** True if this token is still under its per-minute budget (and records the hit). */
export function rateLimitOk(tokenId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(tokenId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(tokenId, recent);
    return false;
  }
  recent.push(now);
  hits.set(tokenId, recent);
  return true;
}

// ---- Brand resolution --------------------------------------------------------

/**
 * Resolve the `brand` argument (name OR id) against the actor's ALLOWED brands.
 * Exactly one allowed brand → it's the default. Otherwise `brand` is required;
 * an unknown/omitted value errors with the list of allowed brand names so the
 * LLM can retry. A user can NEVER reach a brand they aren't a member of.
 */
export async function resolveBrand(
  user: SessionUser,
  brand: string | undefined,
): Promise<Account> {
  const allowed = await allowedAccountsForUser(user);
  if (allowed.length === 0) {
    throw new McpToolError("You have no brand access. Ask an admin to grant a brand.");
  }
  if (brand) {
    const needle = brand.trim().toLowerCase();
    const match = allowed.find(
      (a) => a.id === brand || a.name.toLowerCase() === needle,
    );
    if (!match) {
      throw new McpToolError(
        `Unknown brand "${brand}". Your allowed brands: ${allowed
          .map((a) => a.name)
          .join(", ")}.`,
      );
    }
    return match;
  }
  if (allowed.length === 1) return allowed[0]!;
  throw new McpToolError(
    `You have multiple brands — pass the \`brand\` argument. Allowed brands: ${allowed
      .map((a) => a.name)
      .join(", ")}.`,
  );
}

/** An error whose message is safe to surface to the LLM as a tool result. */
export class McpToolError extends Error {}

// ---- Output helpers ----------------------------------------------------------

const MAX_ROWS = 500;

/** Cap a list to `MAX_ROWS`, reporting whether it was truncated. */
export function capRows<T>(rows: T[]): { rows: T[]; truncated: boolean } {
  if (rows.length <= MAX_ROWS) return { rows, truncated: false };
  return { rows: rows.slice(0, MAX_ROWS), truncated: true };
}

export interface RangeEcho {
  from: string | null;
  to: string | null;
}

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

/**
 * A successful tool result: compact JSON with an unambiguous `{ brand, range }`
 * echo so transcripts stand alone. `range` is null for tools without a window.
 */
export function ok(
  brand: Account,
  range: RangeEcho | null,
  data: Record<string, unknown>,
): ToolResult {
  const payload = {
    brand: { id: brand.id, name: brand.name },
    range,
    ...data,
  };
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

/** An error tool result (isError) — the LLM sees the message and can adjust. */
export function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

/**
 * Wrap a brand-scoped tool: resolve `brand` for the current actor, run `fn`
 * inside `runWithTenant` (so `db/queries/*` are tenant-correct), and translate
 * thrown `McpToolError`s (and anything else) into an error result.
 */
export async function withBrand(
  brand: string | undefined,
  fn: (account: Account) => Promise<ToolResult>,
): Promise<ToolResult> {
  const { user } = currentActor();
  try {
    const account = await resolveBrand(user, brand);
    return await runWithTenant(account.id, user.id, () => fn(account));
  } catch (err) {
    if (err instanceof McpToolError) return fail(err.message);
    console.error("[mcp] tool error:", err);
    return fail(err instanceof Error ? err.message : "Unexpected error");
  }
}
