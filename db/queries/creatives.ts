import {
  and,
  asc,
  between,
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
  tags,
  platformEnum,
  type creativeStatusEnum,
  type creativeTypeEnum,
} from "@/db/schema";
import type { CreativeSort } from "@/validators/creative";

type CreativeType = (typeof creativeTypeEnum)[number];
type CreativeStatus = (typeof creativeStatusEnum)[number];
type Platform = (typeof platformEnum)[number];

export interface CreativeListFilters {
  q?: string;
  productIds?: string[];
  types?: CreativeType[];
  statuses?: CreativeStatus[];
  /** Keep only creatives with ≥1 performance record on these platforms. */
  platforms?: Platform[];
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
  spend7d: number;
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

  const spend7d = db.$with("spend_7d").as(
    db
      .select({
        creativeId: sql<string>`creative_id`.as("creative_id"),
        spend: sql<string>`SUM(spend)`.as("spend"),
      })
      .from(
        sql`(SELECT creative_id, spend FROM performance_records
             WHERE date >= CURRENT_DATE - INTERVAL '7 days'
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
  if (filters.platforms && filters.platforms.length > 0) {
    // Creatives that ran on any of the selected platforms. EXISTS (not a JOIN)
    // so a creative with rows on two platforms isn't counted twice / fanned out.
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${performanceRecords} pr
                  WHERE pr.creative_id = ${creatives.id}
                    AND pr.platform IN ${filters.platforms})`,
    );
  }

  // Build dynamic ORDER BY from the enum. Tuple of SQL fragments is safe
  // because we never interpolate user input here.
  const orderBy = orderByForSort(filters.sort);

  // Qualify CTE columns explicitly — both spend CTEs expose `creative_id` and
  // `spend`, so unqualified refs are ambiguous once both are joined.
  const spendAlias = sql<string | null>`spend_30d.spend`.as("spend_30d");
  const spend7Alias = sql<string | null>`spend_7d.spend`.as("spend_7d");
  const tagsAlias = sql<string[] | null>`${tagAgg.tags}`.as("tag_list");

  const baseQuery = db
    .with(spend30d, spend7d, tagAgg)
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
      spend7d: spend7Alias,
      spend30d: spendAlias,
      totalMatching: sql<string>`COUNT(*) OVER ()`,
    })
    .from(creatives)
    .innerJoin(products, eq(products.id, creatives.productId))
    .leftJoin(spend30d, sql`spend_30d.creative_id = ${creatives.id}`)
    .leftJoin(spend7d, sql`spend_7d.creative_id = ${creatives.id}`)
    .leftJoin(tagAgg, eq(tagAgg.creativeId, creatives.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(...orderBy);

  // The Library board shows EVERY matching creative (the page wraps the grid /
  // table in an internal vertical scroll, like Summary). Previously this capped
  // at 50, which silently hid creatives — with all-NULL launch dates the cap
  // sliced by name and dropped whole types (image/slides) past row 50. Callers
  // that want a smaller page can still pass an explicit `limit`.
  const rows = await (filters.limit
    ? baseQuery.limit(filters.limit)
    : baseQuery);

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
      spend7d: r.spend7d === null ? 0 : Number(r.spend7d),
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
    case "product-asc":
      return [asc(products.name), asc(creatives.name)];
    case "product-desc":
      return [desc(products.name), asc(creatives.name)];
    case "type-asc":
      return [asc(creatives.type), asc(creatives.name)];
    case "type-desc":
      return [desc(creatives.type), asc(creatives.name)];
    case "status-asc":
      return [asc(creatives.status), asc(creatives.name)];
    case "status-desc":
      return [desc(creatives.status), asc(creatives.name)];
    case "tag-asc":
      // First tag alphabetically (MIN over the creative's tags); untagged
      // creatives sort last.
      return [
        sql`(SELECT MIN(${creativeTags.tag}) FROM ${creativeTags}
             WHERE ${creativeTags.creativeId} = ${creatives.id}) ASC NULLS LAST`,
        asc(creatives.name),
      ];
    case "tag-desc":
      return [
        sql`(SELECT MIN(${creativeTags.tag}) FROM ${creativeTags}
             WHERE ${creativeTags.creativeId} = ${creatives.id}) DESC NULLS LAST`,
        asc(creatives.name),
      ];
    case "spend7-desc":
      return [sql`spend_7d DESC NULLS LAST`, asc(creatives.name)];
    case "spend7-asc":
      return [sql`spend_7d ASC NULLS LAST`, asc(creatives.name)];
    case "spend-desc":
      return [sql`spend_30d DESC NULLS LAST`, asc(creatives.name)];
    case "spend-asc":
      return [sql`spend_30d ASC NULLS LAST`, asc(creatives.name)];
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
  platform: "instagram" | "facebook" | "tiktok" | "snapchat" | "google";
  campaignName: string;
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number | null;
  conversionValue: number | null;
  landingPageViews: number | null;
  videoViews2s: number | null;
  videoViews25: number | null;
  videoViews50: number | null;
  videoViews75: number | null;
  videoViews100: number | null;
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
  range?: { from?: string; to?: string },
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
      campaignName: performanceRecords.campaignName,
      landingPageViews: performanceRecords.landingPageViews,
      videoViews2s: performanceRecords.videoViews2s,
      videoViews25: performanceRecords.videoViews25,
      videoViews50: performanceRecords.videoViews50,
      videoViews75: performanceRecords.videoViews75,
      videoViews100: performanceRecords.videoViews100,
      excludedFromAggregates: performanceRecords.excludedFromAggregates,
      excludedReason: performanceRecords.excludedReason,
      excludedAt: performanceRecords.excludedAt,
    })
    .from(performanceRecords)
    .where(
      and(
        eq(performanceRecords.creativeId, creativeId),
        range?.from && range?.to
          ? between(performanceRecords.date, range.from, range.to)
          : undefined,
      ),
    )
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
    campaignName: r.campaignName,
    landingPageViews: r.landingPageViews,
    videoViews2s: r.videoViews2s,
    videoViews25: r.videoViews25,
    videoViews50: r.videoViews50,
    videoViews75: r.videoViews75,
    videoViews100: r.videoViews100,
    excludedFromAggregates: r.excludedFromAggregates,
    excludedReason: r.excludedReason,
    excludedAt: r.excludedAt,
  }));
}

/**
 * Tag list for filter dropdowns + creative-form suggestions. Union of the
 * managed vocabulary (`tags`) and any tags currently in use on creatives —
 * so a freshly-added vocabulary tag is selectable immediately, and any
 * legacy ad-hoc assignment still appears until it's curated.
 */
export async function listAllTags(): Promise<string[]> {
  const rows = await db
    .select({
      tag: sql<string>`t`,
    })
    .from(
      sql`(
        SELECT ${tags.name} AS t FROM ${tags}
        UNION
        SELECT ${creativeTags.tag} AS t FROM ${creativeTags}
      ) AS u`,
    )
    .orderBy(sql`t`);
  return rows.map((r) => r.tag);
}

