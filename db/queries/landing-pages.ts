import { and, asc, count, countDistinct, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { landingPages, performanceRecords, products } from "@/db/schema";
import { getActiveAccountId } from "@/lib/tenant";

export interface LandingPageRow {
  id: string;
  name: string;
  /** Without the `@`. */
  code: string;
  description: string | null;
  url: string;
  /** The product the page sells — null only for a pre-2026-10-29 page the
   *  backfill could not settle ("Needs a product" in the registry). */
  productId: string | null;
  productName: string | null;
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
      productId: landingPages.productId,
      productName: products.name,
      createdAt: landingPages.createdAt,
      creatives: countDistinct(performanceRecords.creativeId),
      records: count(performanceRecords.id),
    })
    .from(landingPages)
    .leftJoin(products, eq(products.id, landingPages.productId))
    .leftJoin(
      performanceRecords,
      and(
        eq(performanceRecords.landingPageId, landingPages.id),
        eq(performanceRecords.accountId, acct),
      ),
    )
    .where(eq(landingPages.accountId, acct))
    .groupBy(landingPages.id, products.name)
    .orderBy(asc(products.name), asc(landingPages.name), asc(landingPages.code));
  return rows.map((r) => ({
    ...r,
    creatives: Number(r.creatives),
    records: Number(r.records),
  }));
}
