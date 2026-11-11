import { cache } from "react";
import { cookies, headers } from "next/headers";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, userAccounts } from "@/db/schema";
import { auth, loadUserById, type SessionUser } from "@/lib/auth";
import { resolveActiveAccountId } from "@/lib/account-access";
import { getTenantContext, withTenantContext } from "@/lib/tenant-context";
import { ANY_BRAND, BRAND_HEADER, LAST_BRAND_COOKIE, isBrandSlug } from "@/lib/brand-path";

/**
 * Active-brand ("account") resolution + brand-membership enforcement.
 *
 * The app is multi-tenant: every tenant-scoped table carries an `account_id`,
 * and every query/write is scoped to the *active* account. Since 2026-11 the
 * active account is the one the URL names — `/<slug>/…`, per TAB — which the
 * middleware hands over in the `x-ccms-brand` header (an API call carries it
 * via `brandFetch`). Without one (a legacy caller), the last brand this
 * browser used (`ccms_brand` slug cookie), then the old `ccms_account` id
 * cookie, then the first allowed brand.
 *
 * Brand membership IS enforced here (the single choke point): a user sees only
 * the brands they're a member of. `users.all_accounts = true` (default/legacy)
 * → every brand, including brands created later; `false` → only the brands in
 * `user_accounts`. Admins are always effectively all-accounts. Because
 * `getActiveAccountId()` only ever returns an ALLOWED id (a forged/stale cookie
 * falls back to the user's first allowed brand), every downstream query is
 * membership-safe without touching the query layer. See lib/account-access.ts
 * for the pure resolution logic.
 *
 * All resolvers are wrapped in React `cache()` so a single render/request hits
 * the DB once, regardless of how many queries call `getActiveAccountId()`.
 */

export const ACCOUNT_COOKIE = "ccms_account";

/** Thrown by `getActiveAccountId()` when the user has zero allowed brands. The
 *  dashboard layout checks `listAccounts()` up-front and renders the friendly
 *  "No brand access" screen before any query runs; this is the backstop. */
export const NO_BRAND_ACCESS = "NO_BRAND_ACCESS";

/** Thrown by `getActiveAccountId()` when the URL names a brand the user may
 *  not see (or that doesn't exist). The dashboard layout renders the refusal
 *  screen first; this stops an action or API call cold — it NEVER falls back
 *  to another brand, which would write into a brand the tab doesn't show. */
export const BRAND_REFUSED = "BRAND_REFUSED";

export interface Account {
  id: string;
  name: string;
  /** The brand's URL segment (`/<slug>/…`). Never changes after creation. */
  slug: string;
  /** "Active" status window in hours (daily-grain → rounds to days). */
  statusWindowHours: number;
  /** The brand's swatch key (`brandColorEnum`), null = derived default. */
  color: string | null;
  /** The brand's uploaded logo, null = none (its initial on its colour). */
  logoUrl: string | null;
}

/**
 * EVERY brand, oldest first — UNFILTERED by membership. Internal + the Team
 * admin (whose editor may grant any brand). Most callers want `listAccounts()`,
 * which filters to the signed-in user's allowed brands.
 */
export const listAllAccounts = cache(async (): Promise<Account[]> => {
  return db
    .select({
      id: accounts.id,
      name: accounts.name,
      slug: accounts.slug,
      statusWindowHours: accounts.statusWindowHours,
      color: accounts.color,
      logoUrl: accounts.logoUrl,
    })
    .from(accounts)
    .orderBy(asc(accounts.createdAt));
});

/**
 * The brands the signed-in user MAY see, oldest first. Admins / all-accounts
 * users get every brand; a restricted user gets the intersection of their
 * `user_accounts` memberships with the brands that still exist. Empty when the
 * user is signed out or has been stripped of every brand.
 */
export async function allowedAccountsForUser(
  user: Pick<SessionUser, "id" | "role" | "allAccounts">,
): Promise<Account[]> {
  // Admins and all-accounts users see every brand (correct — the full list may
  // serialize to their client). A RESTRICTED user must NEVER materialize the
  // unfiltered list on their render path: we query ONLY their member brands
  // (`WHERE id IN (…)`), so no other brand's name can leak into the RSC payload.
  // (The pure `allowedAccountIds` in lib/account-access.ts is the tested spec;
  // the `IN` filter is its leak-safe SQL equivalent — admin/all → all,
  // restricted → intersection with existing brands.)
  if (user.role === "admin" || user.allAccounts) {
    return listAllAccounts();
  }

  const memberAccountIds = (
    await db
      .select({ accountId: userAccounts.accountId })
      .from(userAccounts)
      .where(eq(userAccounts.userId, user.id))
  ).map((r) => r.accountId);
  if (memberAccountIds.length === 0) return [];

  return db
    .select({
      id: accounts.id,
      name: accounts.name,
      slug: accounts.slug,
      statusWindowHours: accounts.statusWindowHours,
      color: accounts.color,
      logoUrl: accounts.logoUrl,
    })
    .from(accounts)
    .where(inArray(accounts.id, memberAccountIds))
    .orderBy(asc(accounts.createdAt));
}

/** The signed-in (cookie) user's allowed brands. `cache()`d per request. */
export const allowedAccounts = cache(async (): Promise<Account[]> => {
  const user = await auth();
  return user ? allowedAccountsForUser(user) : [];
});

/**
 * Every brand this user may see, oldest first. Drives the brand switcher, the
 * Brands admin tab, and `setActiveAccount`'s validation — so membership is
 * enforced everywhere it's consulted. (Renamed semantics: previously "every
 * brand"; now "every ALLOWED brand".)
 */
export const listAccounts = cache((): Promise<Account[]> => allowedAccounts());

/**
 * The brand slug the URL names for this request, if any — the middleware's
 * header on a page or action, `brandFetch`'s on an API call. `_` (the "your
 * last brand" placeholder) counts as none.
 */
export const requestedBrandSlug = cache(async (): Promise<string | null> => {
  const h = (await headers()).get(BRAND_HEADER);
  if (!h || h === ANY_BRAND) return null;
  return h;
});

/**
 * The active account id for this request. When the URL names a brand, THAT
 * brand — and only if the user may see it (else `BRAND_REFUSED`, never a
 * silent fallback). Otherwise the browser's last brand, then the legacy id
 * cookie, then the first allowed brand. Throws `NO_BRAND_ACCESS` when the
 * user has no allowed brands — the layout guards against both up-front, so
 * they never surface to a real page render.
 */
export const getActiveAccountId = cache(async (): Promise<string> => {
  // MCP / cookieless callers set an explicit, already-membership-validated
  // context via `runWithTenant`; it wins over everything.
  const override = getTenantContext();
  if (override) return override.accountId;

  const allowed = await listAccounts();
  const requested = await requestedBrandSlug();
  if (requested) {
    const hit = allowed.find((a) => a.slug === requested);
    if (!hit) throw new Error(allowed.length === 0 ? NO_BRAND_ACCESS : BRAND_REFUSED);
    return hit.id;
  }

  const jar = await cookies();
  const lastSlug = jar.get(LAST_BRAND_COOKIE)?.value;
  if (isBrandSlug(lastSlug)) {
    const hit = allowed.find((a) => a.slug === lastSlug);
    if (hit) return hit.id;
  }
  const id = resolveActiveAccountId(
    allowed.map((a) => a.id),
    jar.get(ACCOUNT_COOKIE)?.value,
  );
  if (id === null) throw new Error(NO_BRAND_ACCESS);
  return id;
});

/**
 * Run `fn` with an EXPLICIT active brand + user, bypassing cookies — for the MCP
 * server, whose requests carry a bearer token, not a session cookie. Validates
 * that `accountId` is one of `userId`'s ALLOWED brands before entering the
 * context (so a token can never reach a brand its owner isn't a member of), then
 * `getActiveAccountId()` / `auth()` transparently read it and every
 * `db/queries/*` function is tenant-correct with zero changes inside it.
 */
export async function runWithTenant<T>(
  accountId: string,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const user = await loadUserById(userId);
  if (!user) throw new Error("Unknown user for tenant context");
  const allowed = await allowedAccountsForUser(user);
  if (!allowed.some((a) => a.id === accountId)) {
    throw new Error("Account not allowed for this user");
  }
  return withTenantContext({ accountId, userId }, fn);
}

/** The active account record (for the switcher's current selection + chrome). */
export const getActiveAccount = cache(async (): Promise<Account> => {
  const [id, all] = await Promise.all([getActiveAccountId(), listAccounts()]);
  return all.find((a) => a.id === id) ?? all[0]!;
});

/** The active brand's "Active" status window, in hours (default 24). */
export const getActiveStatusWindowHours = cache(async (): Promise<number> => {
  const acct = await getActiveAccount();
  return acct.statusWindowHours ?? 24;
});
