import { and, desc, eq, gte, lt, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { audienceSnapshots, users } from "@/db/schema";
import { getActiveAccountId } from "@/lib/tenant";
import type { FunnelStage } from "@/lib/audience";
import type { ALL_PLATFORMS } from "@/lib/palette";

/** The four ad platforms, as the schema's enum types them. */
type Platform = (typeof ALL_PLATFORMS)[number];

/**
 * Funnel-audience reads. The module's spend side is NOT here — it reuses
 * `budgetPacingSeries(from, to)`, which already scans performance records per
 * day × platform × budget bucket. Adding a second spend scan for the same
 * numbers would double the cost of the page for nothing (`lib/db.ts` is
 * `max: 1`, so every query is a serial round-trip).
 */

export interface AudienceSnapshotRow {
  id: string;
  platform: Platform;
  stage: FunnelStage;
  date: string;
  size: number;
}

export interface AudienceSeries {
  /** Every snapshot inside the range, oldest first. */
  inRange: AudienceSnapshotRow[];
  /**
   * Per (platform, stage), the latest snapshot STRICTLY BEFORE the range — the
   * carry-forward seed. Without it a pair measured last month would read as
   * unknown for every day of this one.
   */
  seed: AudienceSnapshotRow[];
}

const COLUMNS = {
  id: audienceSnapshots.id,
  platform: audienceSnapshots.platform,
  stage: audienceSnapshots.stage,
  date: audienceSnapshots.date,
  size: audienceSnapshots.size,
};

/**
 * The raw material for the whole page: the range's snapshots plus the seed.
 *
 * TWO queries, whatever the range. The seed is one `DISTINCT ON (platform,
 * stage)` pass ordered by date descending — never a query per pair.
 */
export async function audienceSnapshotSeries(
  from: string,
  to: string,
): Promise<AudienceSeries> {
  const acct = await getActiveAccountId();
  const [inRange, seed] = await Promise.all([
    db
      .select(COLUMNS)
      .from(audienceSnapshots)
      .where(
        and(
          eq(audienceSnapshots.accountId, acct),
          gte(audienceSnapshots.date, from),
          lte(audienceSnapshots.date, to),
        ),
      )
      .orderBy(audienceSnapshots.date),
    db
      .selectDistinctOn([audienceSnapshots.platform, audienceSnapshots.stage], COLUMNS)
      .from(audienceSnapshots)
      .where(
        and(eq(audienceSnapshots.accountId, acct), lt(audienceSnapshots.date, from)),
      )
      .orderBy(
        audienceSnapshots.platform,
        audienceSnapshots.stage,
        desc(audienceSnapshots.date),
      ),
  ]);

  return { inRange, seed };
}

/**
 * The most recent snapshot per (platform, stage), whenever it was taken — the
 * glance matrix's sizes and the Record dialog's muted prefills. ONE
 * `DISTINCT ON` query.
 */
export async function latestAudienceSnapshots(): Promise<AudienceSnapshotRow[]> {
  const acct = await getActiveAccountId();
  return db
    .selectDistinctOn([audienceSnapshots.platform, audienceSnapshots.stage], COLUMNS)
    .from(audienceSnapshots)
    .where(eq(audienceSnapshots.accountId, acct))
    .orderBy(
      audienceSnapshots.platform,
      audienceSnapshots.stage,
      desc(audienceSnapshots.date),
    );
}

export interface AudienceCorrectionRow extends AudienceSnapshotRow {
  recordedBy: string | null;
  recordedAt: Date;
}

/**
 * The most recent snapshots across every pair, newest measurement first, for
 * the corrections list. BOUNDED — the list is for fixing a typo you just made,
 * not for browsing history.
 */
export async function recentAudienceSnapshots(
  limit = 100,
): Promise<AudienceCorrectionRow[]> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      ...COLUMNS,
      recordedBy: users.name,
      recordedAt: audienceSnapshots.createdAt,
    })
    .from(audienceSnapshots)
    .leftJoin(users, eq(users.id, audienceSnapshots.createdBy))
    .where(eq(audienceSnapshots.accountId, acct))
    .orderBy(desc(audienceSnapshots.date), desc(audienceSnapshots.createdAt))
    .limit(limit);
  return rows;
}
