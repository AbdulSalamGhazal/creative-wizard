import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, auditEvents } from "@/db/schema";
import { AUDIT_ACTIONS } from "@/lib/audit";

/**
 * Reads behind sign-in (D2, 2026-10-23). Nothing here is tenant-scoped: a
 * visitor who is not signed in has no brand, which is exactly why these exist.
 */

/** Failed sign-ins in a row before the next attempt waits. */
export const SIGNIN_THROTTLE_MAX_FAILURES = 5;
/** The sliding window those failures are counted in. */
export const SIGNIN_THROTTLE_WINDOW_MS = 15 * 60 * 1000;

/**
 * The brand an ANONYMOUS auth event is filed under: the oldest one (the
 * user's decision, D2). `logAudit` would otherwise resolve the active brand,
 * which for a visitor with no session throws `NO_BRAND_ACCESS` — and the
 * audit swallowed it, so no failed sign-in was ever recorded. Null only on a
 * database with no brands at all.
 */
export async function oldestAccountId(): Promise<string | null> {
  const [row] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .orderBy(asc(accounts.createdAt), asc(accounts.id))
    .limit(1);
  return row?.id ?? null;
}

/**
 * The failed sign-ins the throttle counts (F1, 2026-10-24): one email's
 * `auth.signin_failed` rows inside the window ending `now` — FROM ONE NETWORK
 * ADDRESS when `ip` is known, so a stranger elsewhere trying your email can't
 * lock you out; across every address when it isn't (no address = the
 * strictest key, never a fresh one). Counted from the audit rows themselves —
 * no new table, and the window slides, so a success needs no reset. Every
 * brand counts: the email is the subject, not the brand. Served by the
 * partial `audit_signin_failed_ip_idx` (email, address, at) and, for the
 * no-address case, `audit_signin_failed_idx` (email, at). Exported as a
 * builder so a test can EXPLAIN the exact query.
 */
export function signInFailuresQuery(email: string, ip: string | null, now: Date) {
  const since = new Date(now.getTime() - SIGNIN_THROTTLE_WINDOW_MS);
  return db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.action, AUDIT_ACTIONS.AUTH_SIGNIN_FAILED),
        eq(auditEvents.entityLabel, email),
        ip === null ? undefined : sql`(${auditEvents.meta} ->> 'ip') = ${ip}`,
        gt(auditEvents.at, since),
      ),
    );
}

/** How many failed sign-ins `signInFailuresQuery` finds (email already normalized). */
export async function recentSignInFailures(
  email: string,
  ip: string | null,
  now: Date = new Date(),
): Promise<number> {
  const [row] = await signInFailuresQuery(email, ip, now);
  return Number(row?.n ?? 0);
}
