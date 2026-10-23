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
 * How many times `email` (already normalized) failed to sign in inside the
 * window ending `now`. Counted from the audit rows themselves — no new table,
 * and the window slides, so a success needs no reset. Every brand counts: the
 * email is the subject, not the brand. Served by the partial
 * `audit_signin_failed_idx`.
 */
export async function recentSignInFailures(
  email: string,
  now: Date = new Date(),
): Promise<number> {
  const since = new Date(now.getTime() - SIGNIN_THROTTLE_WINDOW_MS);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.action, AUDIT_ACTIONS.AUTH_SIGNIN_FAILED),
        eq(auditEvents.entityLabel, email),
        gt(auditEvents.at, since),
      ),
    );
  return Number(row?.n ?? 0);
}
