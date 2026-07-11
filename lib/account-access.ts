/**
 * Pure brand-membership resolution — NO db, NO cookies, NO next/headers. The
 * single source of truth for "which brands may this user see, and which one is
 * active". Kept pure so it's unit-testable; `lib/tenant.ts` feeds it live data
 * (the signed-in user, every brand, the `ccms_account` cookie).
 *
 * Permissions say WHAT a user can do; membership says WHERE. A user is scoped to
 * every brand (`all_accounts = true`, the default/legacy semantics — includes
 * brands created later) unless an admin restricts them to a set in the
 * `user_accounts` table. Admins are ALWAYS effectively all-accounts.
 */

export interface MembershipInput {
  /** Admins bypass membership entirely (like the permission bypass). */
  isAdmin: boolean;
  /** `users.all_accounts` — member of every brand, including future ones. */
  allAccounts: boolean;
  /** Every brand id that exists, in display order (oldest first). */
  allAccountIds: string[];
  /** The user's explicit memberships — consulted ONLY when `!allAccounts`. */
  memberAccountIds: string[];
}

/**
 * The brand ids this user may see, in display order. Admins and all-accounts
 * users get every brand; a restricted user gets the intersection of their
 * memberships with the brands that still exist (so a stale membership to a
 * deleted brand — belt-and-braces with the FK cascade — can't leak).
 */
export function allowedAccountIds(input: MembershipInput): string[] {
  if (input.isAdmin || input.allAccounts) return input.allAccountIds;
  const member = new Set(input.memberAccountIds);
  return input.allAccountIds.filter((id) => member.has(id));
}

/**
 * The active brand id given the allowed set and the `ccms_account` cookie:
 * honor the cookie when it names an ALLOWED brand, else fall back to the first
 * allowed brand (deterministic — `allowed` is display-ordered). A disallowed or
 * stale cookie is NOT an error, it just falls back. Returns null when the user
 * has NO allowed brands (→ the caller renders the "No brand access" screen).
 */
export function resolveActiveAccountId(
  allowed: string[],
  cookieValue: string | undefined | null,
): string | null {
  if (allowed.length === 0) return null;
  if (cookieValue && allowed.includes(cookieValue)) return cookieValue;
  return allowed[0]!;
}
