import { cache } from "react";
import { and, asc, between, count, countDistinct, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { creatives, landingPages, performanceRecords, products } from "@/db/schema";
import { getActiveAccountId } from "@/lib/tenant";
import {
  cpa,
  ctr,
  cvr,
  roas,
  sumClicks,
  sumConversionValue,
  sumConversions,
  sumImpressions,
  sumSpend,
} from "@/lib/metrics";
import { numOrNull } from "@/db/queries/values";
import { creativeStatusMap, statusFor } from "@/db/queries/creative-status";
import type { CampaignCreativeRow } from "@/db/queries/campaign";
import type { CreativeType } from "@/lib/enums";

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

/** One of the brand's landing pages as a registry row (usage counts included —
 *  `records` is what locks its code in the edit dialog). */
async function landingPageWhere(where: SQL): Promise<LandingPageRow | null> {
  const acct = await getActiveAccountId();
  const [row] = await db
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
    .where(and(eq(landingPages.accountId, acct), where))
    .groupBy(landingPages.id, products.name)
    .limit(1);
  if (!row) return null;
  return { ...row, creatives: Number(row.creatives), records: Number(row.records) };
}

/**
 * One of the active brand's landing pages by its CODE (without the `@`) — the
 * detail page's address (`/landing-pages/<code>`). Exact match: the registry
 * refuses a case-only variant, so a code names one page. `cache()`-wrapped so
 * the page and its `generateMetadata` share the fetch. Another brand's code →
 * null (the page 404s).
 */
export const getLandingPageByCode = cache(
  async (code: string): Promise<LandingPageRow | null> =>
    landingPageWhere(eq(landingPages.code, code)),
);

/**
 * The creatives that sent traffic to one landing page in a range — one row
 * per creative, every rate a weighted ratio of that creative's component sums
 * (`lib/metrics.ts`). Same shape as the campaign page's creatives, so the
 * detail page reuses that table. All platforms, like the creative page; the
 * Excluded toggle applies (aggregates hide excluded rows unless it opts in).
 */
export async function landingPageCreatives(
  landingPageId: string,
  range: { from: string; to: string },
  includeExcluded: boolean,
): Promise<CampaignCreativeRow[]> {
  const acct = await getActiveAccountId();
  const conds: SQL[] = [
    eq(performanceRecords.accountId, acct),
    eq(performanceRecords.landingPageId, landingPageId),
    between(performanceRecords.date, range.from, range.to),
  ];
  if (!includeExcluded) conds.push(eq(performanceRecords.excludedFromAggregates, false));
  const rows = await db
    .select({
      creativeId: creatives.id,
      name: creatives.name,
      type: creatives.type,
      thumbnailUrl: creatives.thumbnailUrl,
      productName: products.name,
      stages: creatives.stages,
      priority: creatives.priority,
      launchDate: creatives.launchDate,
      spend: sumSpend,
      impressions: sumImpressions,
      clicks: sumClicks,
      conversions: sumConversions,
      conversionValue: sumConversionValue,
      ctr,
      cvr,
      cpa,
      roas,
      lastDate: sql<string | null>`MAX(${performanceRecords.date})`,
    })
    .from(performanceRecords)
    .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
    .innerJoin(products, eq(products.id, creatives.productId))
    .where(and(...conds))
    .groupBy(
      creatives.id,
      creatives.name,
      creatives.type,
      creatives.thumbnailUrl,
      products.name,
      creatives.stages,
      creatives.priority,
      creatives.launchDate,
    )
    .orderBy(desc(sumSpend));

  const sMap = await creativeStatusMap(rows.map((r) => r.creativeId));
  const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
  return rows.map((r) => ({
    creativeId: r.creativeId,
    name: r.name,
    type: r.type as CreativeType,
    status: statusFor(sMap, r.creativeId).general,
    thumbnailUrl: r.thumbnailUrl,
    productName: r.productName,
    stages: r.stages,
    priority: r.priority,
    launchDate: r.launchDate,
    spend: n(r.spend),
    impressions: n(r.impressions),
    clicks: n(r.clicks),
    conversions: n(r.conversions),
    conversionValue: n(r.conversionValue),
    ctr: numOrNull(r.ctr),
    cvr: numOrNull(r.cvr),
    cpa: numOrNull(r.cpa),
    roas: numOrNull(r.roas),
    lastDate: r.lastDate,
  }));
}
