import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/lib/db";
import {
  creatives,
  creativeTags,
  performanceRecords,
  products,
  type creativeStatusEnum,
  type creativeTypeEnum,
} from "@/db/schema";
import type { CreativeSort } from "@/validators/creative";

type CreativeType = (typeof creativeTypeEnum)[number];
type CreativeStatus = (typeof creativeStatusEnum)[number];

export interface CreativeListFilters {
  q?: string;
  productIds?: string[];
  types?: CreativeType[];
  statuses?: CreativeStatus[];
  tags?: string[];
  sort: CreativeSort;
  limit?: number;
}

export interface CreativeListRow {
  id: string;
  name: string;
  productId: string;
  productName: string;
  type: CreativeType;
  status: CreativeStatus;
  thumbnailUrl: string | null;
  launchDate: string | null;
  tags: string[];
  spend30d: number;
}

export interface CreativeListResult {
  rows: CreativeListRow[];
  totalMatching: number;
}

export interface CreativeStats {
  total: number;
  active: number;
  paused: number;
  addedThisMonth: number;
}

/**
 * Library list with all filter support. Uses two CTEs (spend_30d, tag_agg) so
 * the 30-day spend and tag list join per-creative without fan-out. The
 * `total_matching` column comes from a window count so the caller can render
 * "Showing N of M" without a second query.
 *
 * Search (q) is ILIKE across name, notes, and joined tags. For the seeded
 * dataset (< 10 rows) this is fine; revisit pg_trgm + GIN once N > 10k or
 * p95 > 100 ms.
 */
export async function listCreatives(
  filters: CreativeListFilters,
): Promise<CreativeListResult> {
  const limit = filters.limit ?? 50;

  const spend30d = db.$with("spend_30d").as(
    db
      .select({
        creativeId: sql<string>`creative_id`.as("creative_id"),
        spend: sql<string>`SUM(spend)`.as("spend"),
      })
      .from(
        sql`(SELECT creative_id, spend FROM performance_records
             WHERE date >= CURRENT_DATE - INTERVAL '30 days'
               AND excluded_from_aggregates = false) AS pr`,
      )
      .groupBy(sql`creative_id`),
  );

  const tagAgg = db.$with("tag_agg").as(
    db
      .select({
        creativeId: creativeTags.creativeId,
        tags: sql<string[]>`array_agg(${creativeTags.tag} ORDER BY ${creativeTags.tag})`.as(
          "tags",
        ),
      })
      .from(creativeTags)
      .groupBy(creativeTags.creativeId),
  );

  const conditions: SQL[] = [];

  if (filters.q) {
    const pattern = `%${filters.q}%`;
    conditions.push(
      or(
        ilike(creatives.name, pattern),
        ilike(creatives.notes, pattern),
        sql`EXISTS (SELECT 1 FROM ${creativeTags} ct
                    WHERE ct.creative_id = ${creatives.id}
                      AND ct.tag ILIKE ${pattern})`,
      )!,
    );
  }
  if (filters.productIds && filters.productIds.length > 0) {
    conditions.push(inArray(creatives.productId, filters.productIds));
  }
  if (filters.types && filters.types.length > 0) {
    conditions.push(inArray(creatives.type, filters.types));
  }
  if (filters.statuses && filters.statuses.length > 0) {
    conditions.push(inArray(creatives.status, filters.statuses));
  }
  if (filters.tags && filters.tags.length > 0) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${creativeTags} ct
                  WHERE ct.creative_id = ${creatives.id}
                    AND ct.tag IN ${filters.tags})`,
    );
  }

  // Build dynamic ORDER BY from the enum. Tuple of SQL fragments is safe
  // because we never interpolate user input here.
  const orderBy = orderByForSort(filters.sort);

  const spendAlias = sql<string | null>`${spend30d.spend}`.as("spend_30d");
  const tagsAlias = sql<string[] | null>`${tagAgg.tags}`.as("tag_list");

  const rows = await db
    .with(spend30d, tagAgg)
    .select({
      id: creatives.id,
      name: creatives.name,
      productId: creatives.productId,
      productName: products.name,
      type: creatives.type,
      status: creatives.status,
      thumbnailUrl: creatives.thumbnailUrl,
      launchDate: creatives.launchDate,
      tags: tagsAlias,
      spend30d: spendAlias,
      totalMatching: sql<string>`COUNT(*) OVER ()`,
    })
    .from(creatives)
    .innerJoin(products, eq(products.id, creatives.productId))
    .leftJoin(spend30d, sql`${spend30d.creativeId} = ${creatives.id}`)
    .leftJoin(tagAgg, eq(tagAgg.creativeId, creatives.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(...orderBy)
    .limit(limit);

  const totalMatching = rows[0] ? Number(rows[0].totalMatching) : 0;

  return {
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      productId: r.productId,
      productName: r.productName,
      type: r.type as CreativeType,
      status: r.status as CreativeStatus,
      thumbnailUrl: r.thumbnailUrl,
      launchDate: r.launchDate,
      tags: r.tags ?? [],
      spend30d: r.spend30d === null ? 0 : Number(r.spend30d),
    })),
    totalMatching,
  };
}

function orderByForSort(sort: CreativeSort): SQL[] {
  switch (sort) {
    case "launched-desc":
      return [sql`${creatives.launchDate} DESC NULLS LAST`, asc(creatives.name)];
    case "launched-asc":
      return [sql`${creatives.launchDate} ASC NULLS LAST`, asc(creatives.name)];
    case "name-asc":
      return [asc(creatives.name)];
    case "name-desc":
      return [desc(creatives.name)];
    case "spend-desc":
      return [sql`spend_30d DESC NULLS LAST`, asc(creatives.name)];
    case "created-desc":
      return [desc(creatives.createdAt)];
  }
}

/** Header stats: total / active / paused / added-this-month. */
export async function creativeStats(): Promise<CreativeStats> {
  const [row] = await db
    .select({
      total: sql<string>`COUNT(*)`,
      active: sql<string>`COUNT(*) FILTER (WHERE ${creatives.status} = 'active')`,
      paused: sql<string>`COUNT(*) FILTER (WHERE ${creatives.status} = 'paused')`,
      addedThisMonth: sql<string>`COUNT(*) FILTER (WHERE ${creatives.createdAt} >= date_trunc('month', now()))`,
    })
    .from(creatives);

  return {
    total: Number(row?.total ?? 0),
    active: Number(row?.active ?? 0),
    paused: Number(row?.paused ?? 0),
    addedThisMonth: Number(row?.addedThisMonth ?? 0),
  };
}

// -----------------------------------------------------------------------------
// Creative Detail queries
// -----------------------------------------------------------------------------

export interface CreativeDetail {
  id: string;
  name: string;
  productId: string;
  productName: string;
  type: CreativeType;
  status: CreativeStatus;
  thumbnailUrl: string | null;
  launchDate: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  tags: string[];
}

export async function getCreativeByName(
  name: string,
): Promise<CreativeDetail | null> {
  const [row] = await db
    .select({
      id: creatives.id,
      name: creatives.name,
      productId: creatives.productId,
      productName: products.name,
      type: creatives.type,
      status: creatives.status,
      thumbnailUrl: creatives.thumbnailUrl,
      launchDate: creatives.launchDate,
      notes: creatives.notes,
      createdAt: creatives.createdAt,
      updatedAt: creatives.updatedAt,
    })
    .from(creatives)
    .innerJoin(products, eq(products.id, creatives.productId))
    .where(eq(creatives.name, name))
    .limit(1);

  if (!row) return null;

  const tagRows = await db
    .select({ tag: creativeTags.tag })
    .from(creativeTags)
    .where(eq(creativeTags.creativeId, row.id))
    .orderBy(asc(creativeTags.tag));

  return {
    ...row,
    type: row.type as CreativeType,
    status: row.status as CreativeStatus,
    tags: tagRows.map((t) => t.tag),
  };
}

export interface CreativeRecordRow {
  id: number;
  platform: "meta" | "tiktok" | "snapchat" | "google";
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number | null;
  conversionValue: number | null;
  videoViews3s: number | null;
  videoViews15s: number | null;
  excludedFromAggregates: boolean;
  excludedReason: string | null;
  excludedAt: Date | null;
}

/**
 * All performance records for a single creative, newest first. Detail views
 * always show every record regardless of exclusion (PRD §5.4); the caller
 * uses `excludedFromAggregates` to render an "Excluded" badge.
 */
export async function creativeRecords(
  creativeId: string,
): Promise<CreativeRecordRow[]> {
  const rows = await db
    .select({
      id: performanceRecords.id,
      platform: performanceRecords.platform,
      date: performanceRecords.date,
      spend: performanceRecords.spend,
      impressions: performanceRecords.impressions,
      clicks: performanceRecords.clicks,
      conversions: performanceRecords.conversions,
      conversionValue: performanceRecords.conversionValue,
      videoViews3s: performanceRecords.videoViews3s,
      videoViews15s: performanceRecords.videoViews15s,
      excludedFromAggregates: performanceRecords.excludedFromAggregates,
      excludedReason: performanceRecords.excludedReason,
      excludedAt: performanceRecords.excludedAt,
    })
    .from(performanceRecords)
    .where(eq(performanceRecords.creativeId, creativeId))
    .orderBy(desc(performanceRecords.date), asc(performanceRecords.platform));

  return rows.map((r) => ({
    id: r.id,
    platform: r.platform as CreativeRecordRow["platform"],
    date: r.date,
    spend: Number(r.spend),
    impressions: r.impressions,
    clicks: r.clicks,
    conversions: r.conversions,
    conversionValue: r.conversionValue === null ? null : Number(r.conversionValue),
    videoViews3s: r.videoViews3s,
    videoViews15s: r.videoViews15s,
    excludedFromAggregates: r.excludedFromAggregates,
    excludedReason: r.excludedReason,
    excludedAt: r.excludedAt,
  }));
}

/** Distinct tag list for the tag-filter dropdown. */
export async function listAllTags(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ tag: creativeTags.tag })
    .from(creativeTags)
    .orderBy(asc(creativeTags.tag));
  return rows.map((r) => r.tag);
}

