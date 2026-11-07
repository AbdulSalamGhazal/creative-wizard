import { cache } from "react";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { readSession, sessionRevoked } from "@/lib/auth-cookie";
import { getTenantContext } from "@/lib/tenant-context";
import {
  type Permission,
  type RoleTier,
  resolvePermissions,
} from "@/lib/permissions";

/**
 * Open-by-email auth (PRD trade-off).
 *
 * The session cookie carries a user id. `auth()` reads it, validates the HMAC
 * signature, and looks the user up (including their permission set).
 * `requireAuth` throws on a missing session; `requirePermission(perm)` throws
 * when the user lacks a capability — the caller (a Server Action or Route
 * Handler) should catch these and return 401/403.
 *
 * Authorization is GRANULAR: `users.role` is a coarse tier (admin bypasses
 * everything; editor/viewer are fallback presets) and `users.permissions` is an
 * optional explicit per-user set. See lib/permissions.ts for the catalog and
 * how a set is resolved. READ stays role-free — anyone signed in can view.
 */

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: RoleTier;
  /** Explicit permission set; NULL → derive from `role` (the preset). */
  permissions: string[] | null;
  /**
   * Brand membership scope: `true` → every brand (incl. future ones); `false` →
   * only the brands in `user_accounts`. Admins are always effectively `true`.
   * See lib/tenant.ts / lib/account-access.ts.
   */
  allAccounts: boolean;
  /** Profile photo (public URL), or null → coloured initials. Migration 0055. */
  avatarUrl: string | null;
}

/**
 * Load a user into the `SessionUser` shape by id. Shared by `auth()` (cookie
 * session) and `verifyApiToken()` (MCP bearer token) so both resolve identity
 * identically. Null when the id no longer exists.
 */
export async function loadUserById(
  userId: string,
): Promise<SessionUser | null> {
  return (await loadUserRow(userId))?.user ?? null;
}

/**
 * The signed-in person's own preferences, raw, as stored on their `users` row
 * (W2-5, 2026-10). Read in the SAME query as the identity — they used to be
 * three more `select … from users where id = $1` per request, one per getter
 * (db/queries/user-prefs.ts decodes them). Kept off `SessionUser`, which is
 * handed to client components.
 */
export interface SessionPrefs {
  preferredDateRange: string | null;
  includeExcluded: boolean | null;
  toastScope: string | null;
}

/**
 * The user plus their session-revocation stamp and prefs (kept off
 * `SessionUser`). A DEACTIVATED or REMOVED person (D4, 2026-11-06) reads as
 * gone: every cookie, MCP token and OAuth grant resolves identity through
 * here, so one filter ends all of them at once — the dashboard layout then
 * sends the cookie back through sign-in, which refuses it in words.
 */
async function loadUserRow(
  userId: string,
): Promise<{ user: SessionUser; sessionsRevokedAt: Date | null; prefs: SessionPrefs } | null> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      permissions: users.permissions,
      allAccounts: users.allAccounts,
      avatarUrl: users.avatarUrl,
      sessionsRevokedAt: users.sessionsRevokedAt,
      preferredDateRange: users.preferredDateRange,
      includeExcluded: users.includeExcluded,
      toastScope: users.toastScope,
    })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deactivatedAt), isNull(users.removedAt)))
    .limit(1);

  if (!row) return null;
  const { sessionsRevokedAt, preferredDateRange, includeExcluded, toastScope, ...rest } = row;
  return {
    user: {
      ...rest,
      role: rest.role as RoleTier,
      permissions: rest.permissions ?? null,
    },
    sessionsRevokedAt,
    prefs: { preferredDateRange, includeExcluded, toastScope },
  };
}

/**
 * End every session `userId` has — each cookie issued before `at` is signed
 * out on its next request (D3). The caller that wants to KEEP the current
 * device signed in re-issues its cookie afterwards (`setSessionCookie`),
 * which is signed at or after `at`.
 */
export async function endSessions(userId: string, at: Date): Promise<void> {
  await db.update(users).set({ sessionsRevokedAt: at }).where(eq(users.id, userId));
}

/**
 * `cache()` deduplicates within a single request — multiple components on the
 * same page calling `auth()` only hit the DB once.
 *
 * MCP note: consults the tenant-context override first (a bearer-authed MCP
 * request has no cookie), so the token's user is the identity for that request.
 */
const sessionRow = cache(
  async (): Promise<{ user: SessionUser; prefs: SessionPrefs } | null> => {
    const override = getTenantContext();
    if (override) return loadUserRow(override.userId);

    const session = await readSession();
    if (!session) return null;
    const loaded = await loadUserRow(session.userId);
    if (!loaded) return null;
    // A cookie issued before the person's sessions were ended is signed out (D3).
    if (sessionRevoked(session.issuedAt, loaded.sessionsRevokedAt)) return null;
    return loaded;
  },
);

export const auth = cache(async (): Promise<SessionUser | null> => {
  return (await sessionRow())?.user ?? null;
});

/**
 * The signed-in person's raw preferences — from the row `auth()` already read,
 * so asking costs no query (W2-5). Null when signed out.
 */
export const sessionPrefs = cache(async (): Promise<SessionPrefs | null> => {
  return (await sessionRow())?.prefs ?? null;
});

export async function requireAuth(): Promise<SessionUser> {
  const user = await auth();
  if (!user) throw new Error("Unauthorized");
  return user;
}

/**
 * Whether `user` has `perm`. Admins always do; everyone else gets their explicit
 * set (or the role preset when they have none). Pure + synchronous so it can be
 * used in server components (gating rendered UI) as well as the guards below.
 */
export function can(
  user: Pick<SessionUser, "role" | "permissions">,
  perm: Permission,
): boolean {
  if (user.role === "admin") return true;
  return resolvePermissions(user.role, user.permissions).has(perm);
}

/** The user's effective granted permissions, as a plain array (for the UI). */
export function grantedPermissions(
  user: Pick<SessionUser, "role" | "permissions">,
): Permission[] {
  return [...resolvePermissions(user.role, user.permissions)];
}

/**
 * Require the signed-in user to hold `perm`; throws (403-style) otherwise. The
 * granular replacement for `requireEditor` — the server IS the boundary, so
 * every mutating action / route calls this.
 */
export async function requirePermission(perm: Permission): Promise<SessionUser> {
  const user = await requireAuth();
  if (!can(user, perm)) {
    throw new Error(`Missing permission: ${perm}`);
  }
  return user;
}

const REFUSAL_PREFIX = "Missing permission: ";

/**
 * A gate check as a PAGE runs it (R-011, 2026-11-07): the same
 * `requirePermission` / `requirePriceStructureAccess` the actions use, but a
 * permission refusal comes back as null so the page renders `AccessRefused`
 * instead of throwing into the error boundary's "Something went wrong" and a
 * Try again that can never succeed. Anything else — the sign-in redirect, a
 * database error — still throws. Actions keep the bare call: a thrown refusal
 * is their failure channel.
 */
export async function refusable<T>(check: () => Promise<T>): Promise<T | null> {
  try {
    return await check();
  } catch (e) {
    if (e instanceof Error && e.message.startsWith(REFUSAL_PREFIX)) return null;
    throw e;
  }
}
