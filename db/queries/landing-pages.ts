import { and, asc, count, countDistinct, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { landingPages, performanceRecords } from "@/db/schema";
import { getActiveAccountId } from "@/lib/tenant";

export interface LandingPageRow {
  id: string;
  name: string;
  /** Without the `@`. */
  code: string;
  description: string | null;
  url: string;
  createdAt: Date;
  /** Distinct creatives with at least one record sent to this page. */
  creatives: number;
  /** Records pointing here. Above zero, the code is locked and the row can't
   *  be deleted (the FK has no cascade). */
  records: number;
}

/**
 * The active brand's landing pages with their usage, for the Library's
 * Landing pages tab (managers edit it; uploaders read it). One grouped LEFT
 * JOIN — the count rides `perf_landing_page_idx`; rolled-back batches are
 * already gone from the table, so every row counted is live.
 */
export async function listLandingPages(): Promise<LandingPageRow[]> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      id: landingPages.id,
      name: landingPages.name,
      code: landingPages.code,
      description: landingPages.description,
      url: landingPages.url,
      createdAt: landingPages.createdAt,
      creatives: countDistinct(performanceRecords.creativeId),
      records: count(performanceRecords.id),
    })
    .from(landingPages)
    .leftJoin(
      performanceRecords,
      and(
        eq(performanceRecords.landingPageId, landingPages.id),
        eq(performanceRecords.accountId, acct),
      ),
    )
    .where(eq(landingPages.accountId, acct))
    .groupBy(landingPages.id)
    .orderBy(asc(landingPages.name), asc(landingPages.code));
  return rows.map((r) => ({
    ...r,
    creatives: Number(r.creatives),
    records: Number(r.records),
  }));
}
