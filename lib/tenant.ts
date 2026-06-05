import { cache } from "react";
import { cookies } from "next/headers";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, DEFAULT_ACCOUNT_ID } from "@/db/schema";

/**
 * Active-brand ("account") resolution.
 *
 * The app is multi-tenant: every tenant-scoped table carries an `account_id`,
 * and every query/write is scoped to the *active* account. The active account
 * is selected by the user via the brand switcher and stored in the
 * `ccms_account` cookie. It's a view preference, not a security boundary — any
 * signed-in user may switch to any brand — so the cookie is plain (validated
 * against the accounts table, with a safe default).
 *
 * All resolvers are wrapped in React `cache()` so a single render/request hits
 * the DB once, regardless of how many queries call `getActiveAccountId()`.
 */

export const ACCOUNT_COOKIE = "ccms_account";

export interface Account {
  id: string;
  name: string;
  slug: string;
}

/** Every brand, oldest first (the oldest is the default/fallback). */
export const listAccounts = cache(async (): Promise<Account[]> => {
  return db
    .select({ id: accounts.id, name: accounts.name, slug: accounts.slug })
    .from(accounts)
    .orderBy(asc(accounts.createdAt));
});

/**
 * The active account id for this request: the `ccms_account` cookie when it
 * names a real account, otherwise the default (oldest brand = Urjwan).
 */
export const getActiveAccountId = cache(async (): Promise<string> => {
  const all = await listAccounts();
  if (all.length === 0) return DEFAULT_ACCOUNT_ID; // pre-seed safety net

  const jar = await cookies();
  const chosen = jar.get(ACCOUNT_COOKIE)?.value;
  if (chosen && all.some((a) => a.id === chosen)) return chosen;

  return all[0]!.id;
});

/** The active account record (for the switcher's current selection + chrome). */
export const getActiveAccount = cache(async (): Promise<Account> => {
  const [id, all] = await Promise.all([getActiveAccountId(), listAccounts()]);
  return all.find((a) => a.id === id) ?? all[0] ?? {
    id: DEFAULT_ACCOUNT_ID,
    name: "Urjwan",
    slug: "urjwan",
  };
});
