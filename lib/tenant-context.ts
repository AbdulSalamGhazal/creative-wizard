import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request-scoped tenant override — the escape hatch for callers that have NO
 * cookie (the MCP server at `/api/mcp`, authed by a per-user bearer token).
 *
 * The web app resolves the active brand + user from cookies (`getActiveAccountId`
 * / `auth` in the sibling modules). An MCP request instead establishes an
 * explicit context with `runWithTenant(accountId, userId, fn)` (see lib/tenant.ts,
 * which validates the account is ALLOWED for that user before entering here).
 * `getActiveAccountId()` and `auth()` consult `getTenantContext()` FIRST and only
 * fall back to cookies when it's absent — so every `db/queries/*` function is
 * tenant-correct with zero changes inside it.
 *
 * This module deliberately imports nothing from `lib/auth` / `lib/tenant` so it
 * can be shared by both without an import cycle.
 */

export interface TenantContext {
  /** The resolved (and membership-validated) active brand id. */
  accountId: string;
  /** The acting user's id — the token owner, for `auth()` under MCP. */
  userId: string;
}

const store = new AsyncLocalStorage<TenantContext>();

/** The current override, or undefined when running under normal (cookie) auth. */
export function getTenantContext(): TenantContext | undefined {
  return store.getStore();
}

/** Run `fn` with an explicit tenant/user context on the async call stack. */
export function withTenantContext<T>(
  ctx: TenantContext,
  fn: () => Promise<T>,
): Promise<T> {
  return store.run(ctx, fn);
}
