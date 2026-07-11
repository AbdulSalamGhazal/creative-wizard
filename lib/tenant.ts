import { cache } from "react";
import { cookies } from "next/headers";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, userAccounts } from "@/db/schema";
import { auth } from "@/lib/auth";
import { resolveActiveAccountId } from "@/lib/account-access";

/**
 * Active-brand ("account") resolution + brand-membership enforcement.
 *
 * The app is multi-tenant: every tenant-scoped table carries an `account_id`,
 * and every query/write is scoped to the *active* account. The active account
 * is selected by the user via the brand switcher and stored in the
 * `ccms_account` cookie.
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

export interface Account {
  id: string;
  name: string;
  slug: string;
  /** "Active" status window in hours (daily-grain → rounds to days). */
  statusWindowHours: number;
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
export const allowedAccounts = cache(async (): Promise<Account[]> => {
  const user = await auth();
  if (!user) return [];

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
    })
    .from(accounts)
    .where(inArray(accounts.id, memberAccountIds))
    .orderBy(asc(accounts.createdAt));
});

/**
 * Every brand this user may see, oldest first. Drives the brand switcher, the
 * Brands admin tab, and `setActiveAccount`'s validation — so membership is
 * enforced everywhere it's consulted. (Renamed semantics: previously "every
 * brand"; now "every ALLOWED brand".)
 */
export const listAccounts = cache((): Promise<Account[]> => allowedAccounts());

/**
 * The active account id for this request: the `ccms_account` cookie when it
 * names an ALLOWED brand, otherwise the user's first allowed brand (a
 * disallowed/stale cookie falls back, it is not an error). Throws
 * `NO_BRAND_ACCESS` when the user has no allowed brands — the layout guards
 * against this up-front so it never surfaces to a real page render.
 */
export const getActiveAccountId = cache(async (): Promise<string> => {
  const allowed = await listAccounts();
  const jar = await cookies();
  const chosen = jar.get(ACCOUNT_COOKIE)?.value;
  const id = resolveActiveAccountId(
    allowed.map((a) => a.id),
    chosen,
  );
  if (id === null) throw new Error(NO_BRAND_ACCESS);
  return id;
});

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
