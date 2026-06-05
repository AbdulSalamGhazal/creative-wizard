import { and, between, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { creatives, performanceRecords, platformEnum } from "@/db/schema";
import { getActiveAccountId } from "@/lib/tenant";

type Platform = (typeof platformEnum)[number];

export interface CleanupMatch {
  platforms?: Platform[];
  from?: string;
  to?: string;
  productIds?: string[];
  creativeIds?: string[];
}

export interface CleanupPreview {
  rows: number;
  spend: number;
  creatives: number;
  from: string | null;
  to: string | null;
}

/**
 * Build the WHERE conditions shared by the preview and the delete so they
 * match exactly the same rows. Returns an empty array when no filter is set
 * — callers MUST treat empty as "match nothing" and refuse to delete.
 */
function buildConditions(f: CleanupMatch, acct: string): SQL[] {
  const conds: SQL[] = [eq(performanceRecords.accountId, acct)];
  if (f.platforms && f.platforms.length > 0) {
    conds.push(inArray(performanceRecords.platform, f.platforms));
  }
  if (f.from && f.to) {
    conds.push(between(performanceRecords.date, f.from, f.to));
  }
  if (f.creativeIds && f.creativeIds.length > 0) {
    conds.push(inArray(performanceRecords.creativeId, f.creativeIds));
  }
  if (f.productIds && f.productIds.length > 0) {
    // performance_records has no product_id; match creatives under the
    // selected products via a subquery.
    conds.push(
      inArray(
        performanceRecords.creativeId,
        db
          .select({ id: creatives.id })
          .from(creatives)
          .where(inArray(creatives.productId, f.productIds)),
      ),
    );
  }
  return conds;
}

/**
 * Did the user supply at least one real filter? The account scope is always
 * present in the SQL conditions, so we can't infer "no filter" from the
 * conditions array — we check the user-facing fields directly. Callers MUST
 * treat false as "match nothing" and refuse to delete.
 */
function hasAnyFilter(f: CleanupMatch): boolean {
  return Boolean(
    (f.platforms && f.platforms.length > 0) ||
      (f.from && f.to) ||
      (f.creativeIds && f.creativeIds.length > 0) ||
      (f.productIds && f.productIds.length > 0),
  );
}

/** Count + summarize what a cleanup selection would affect. Read-only. */
export async function previewCleanup(f: CleanupMatch): Promise<CleanupPreview> {
  if (!hasAnyFilter(f)) {
    return { rows: 0, spend: 0, creatives: 0, from: null, to: null };
  }
  const conds = buildConditions(f, await getActiveAccountId());
  const [row] = await db
    .select({
      rows: sql<number>`count(*)::int`,
      spend: sql<number>`COALESCE(SUM(${performanceRecords.spend}), 0)::float8`,
      creatives: sql<number>`count(DISTINCT ${performanceRecords.creativeId})::int`,
      minDate: sql<string | null>`MIN(${performanceRecords.date})`,
      maxDate: sql<string | null>`MAX(${performanceRecords.date})`,
    })
    .from(performanceRecords)
    .where(and(...conds));

  return {
    rows: Number(row?.rows ?? 0),
    spend: Number(row?.spend ?? 0),
    creatives: Number(row?.creatives ?? 0),
    from: row?.minDate ?? null,
    to: row?.maxDate ?? null,
  };
}

/**
 * Hard-delete every performance_record matching the selection. Returns the
 * number of rows removed. Refuses to run with no filter (returns 0) as a
 * last-resort guard against deleting everything.
 *
 * NOTE: this is a sanctioned second exit path for performance_records
 * (admin-only, audited at the action layer) in addition to batch rollback.
 */
export async function deleteRecords(f: CleanupMatch): Promise<number> {
  if (!hasAnyFilter(f)) return 0;
  const conds = buildConditions(f, await getActiveAccountId());
  const deleted = await db
    .delete(performanceRecords)
    .where(and(...conds))
    .returning({ id: performanceRecords.id });
  return deleted.length;
}
