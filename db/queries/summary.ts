import {
  and,
  asc,
  between,
  desc,
  eq,
  ilike,
  inArray,
  sql,
  type SQL,
} from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  creatives,
  creativeTags,
  creativeTypeEnum,
  performanceRecords,
  platformEnum,
  products,
  users,
} from "@/db/schema";
import {
  ctr,
  cpa,
  cpc,
  cpm,
  completeRate,
  cvr,
  hookRate,
  holdRate,
  platformMetrics,
  roas,
  sumClicks,
  sumConversionValue,
  sumConversions,
  sumImpressions,
  sumLandingPageViews,
  sumSpend,
  voc,
} from "@/lib/metrics";
import {
  METRIC_META,
  type MetricColumnKey,
  type MetricFilterCondition,
  type RateFilterCondition,
  type SortDir,
} from "@/validators/summary";
import {
  DEFAULT_RATING_CONFIG,
  RATING_RANK,
  rateBlock,
  rulesForScope,
  type RatingConfig,
} from "@/lib/rating";
import { getActiveAccountId } from "@/lib/tenant";
import { creativeStatusMap, statusFor } from "@/db/queries/creative-status";
import {
  STATUS_ORDER,
  type CreativeStatus as DynamicCreativeStatus,
  type PlatformStatus,
} from "@/lib/creative-status";

type Platform = (typeof platformEnum)[number];
type CreativeType = (typeof creativeTypeEnum)[number];

/** Status-filter input — keep rows whose dynamic status on the chosen scope is
 *  in `statuses`. Scope "total" → general roll-up; a platform → that platform's
 *  per-platform status. Mirrors the rate filter's scope handling. */
export interface StatusFilterInput {
  scope: "total" | Platform;
  statuses: DynamicCreativeStatus[];
}

export interface SummaryFilterInput {
  from?: string;
  to?: string;
  q?: string;
  productIds?: string[];
  /** Platforms to render columns for. Capped to ≤3 by the validator. */
  platforms?: Platform[];
  types?: CreativeType[];
  tags?: string[];
  creatorIds?: string[];
  includeExcluded?: boolean;
  sort?: string;
  dir?: SortDir;
  /** Numeric predicates applied to each creative's blended total (ANDed). */
  metricFilters?: MetricFilterCondition[];
  /** Categorical rating filter (scope + selected ratings). */
  rateFilter?: RateFilterCondition | null;
  /** Dynamic status filter (scope + selected statuses). */
  statusFilter?: StatusFilterInput | null;
  /** Rules driving the rating (default + per-platform) — for rate sort/filter. */
  ratingConfig?: RatingConfig;
}

export interface PlatformMetricBlock {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number | null;
  conversionValue: number | null;
  ctr: number | null;
  cpm: number | null;
  cpc: number | null;
  cpa: number | null;
  roas: number | null;
  hookRate: number | null;
  holdRate: number | null;
  completeRate: number | null;
  landingPageViews: number;
  voc: number | null;
  cvr: number | null;
}

export interface SummaryRow {
  creativeId: string;
  name: string;
  productName: string;
  productId: string;
  type: CreativeType;
  /** Dynamic general status — derived roll-up across platforms (new/active/pause/terminated). */
  generalStatus: DynamicCreativeStatus;
  /** Dynamic per-platform status for platforms this creative has presence on. */
  perPlatformStatus: Partial<Record<Platform, PlatformStatus>>;
  creatorName: string | null;
  creatorEmail: string | null;
  tags: string[];
  /** One entry per selected platform; key is the platform string. */
  perPlatform: Partial<Record<Platform, PlatformMetricBlock>>;
  /**
   * Cross-platform blended total. Same shape as a platform block but each
   * value is the weighted aggregate across all SELECTED platforms (not
   * across all platforms in the database).
   */
  total: PlatformMetricBlock;
}

export interface SummaryResult {
  rows: SummaryRow[];
  /** The platforms actually used to build the columns (post-validation). */
  platforms: Platform[];
  /** Echo of the effective sort applied (after validation + fallback). */
  effectiveSort: { key: string; dir: SortDir };
}

/** All sort keys that are always valid (identity columns). */
const IDENTITY_SORT_KEYS = new Set([
  "name",
  "product",
  "type",
  "status",
  "creator",
]);

/** Per-platform metric keys (one suffix per metric). */
const METRIC_KEYS = [
  "spend",
  "impressions",
  "clicks",
  "conversions",
  "ctr",
  "cpm",
  "cpc",
  "cpa",
  "roas",
  "hook_rate",
  "hold_rate",
  "complete_rate",
  "landing_page_views",
  "voc",
  "cvr",
] as const;
type MetricKey = (typeof METRIC_KEYS)[number];

const DEFAULT_SORT = { key: "total.spend", dir: "desc" as SortDir };

/**
 * Resolve a user-supplied sort key against the selected platforms. Unknown
 * or hidden-platform keys collapse to the default ("total.spend" desc).
 */
function resolveSort(
  sort: string | undefined,
  dir: SortDir | undefined,
  selectedPlatforms: Platform[],
): { key: string; dir: SortDir } {
  const direction: SortDir = dir ?? "desc";
  if (!sort) return DEFAULT_SORT;
  if (IDENTITY_SORT_KEYS.has(sort)) return { key: sort, dir: direction };
  // Per-platform / total metric keys: "<platform | total>.<metric>"
  const [scope, metric] = sort.split(".");
  if (!scope || !metric) return DEFAULT_SORT;
  // "rate" and "status" are derived categorical columns sortable per scope
  // (both handled by a JS re-sort, not SQL).
  if (
    metric !== "rate" &&
    metric !== "status" &&
    !METRIC_KEYS.includes(metric as MetricKey)
  ) {
    return DEFAULT_SORT;
  }
  // The blended total has a Rate cell but no per-platform status chip, so
  // "total.status" isn't a real column — fall back to the default sort.
  if (metric === "status" && scope === "total") return DEFAULT_SORT;
  if (scope === "total") return { key: sort, dir: direction };
  if (selectedPlatforms.includes(scope as Platform)) {
    return { key: sort, dir: direction };
  }
  return DEFAULT_SORT;
}

/**
 * Produce the SQL expression to order by given a resolved sort key. The
 * caller has already validated the key against the selected platforms.
 *
 * NB: sorting on a derived metric (ctr, cpa, etc.) of an empty platform
 * column returns NULL. The caller wraps the returned metric expression in
 * COALESCE(expr, 0) so NULLs sort at the 0 position (the "null sorts as 0"
 * rule); this function just returns the raw expression.
 */
function orderBySql(
  key: string,
  selectedPlatforms: Platform[],
  metricsByPlatform: Map<Platform, ReturnType<typeof platformMetrics>>,
): PgColumn | SQL<unknown> {
  if (IDENTITY_SORT_KEYS.has(key)) {
    switch (key) {
      case "name":
        return creatives.name;
      case "product":
        return products.name;
      case "type":
        return creatives.type;
      case "status":
        // Dynamic general status can't be a SQL sort (it's derived in JS). Give
        // SQL a neutral stable base (spend desc); the JS re-sort below applies
        // the real STATUS_ORDER ordering. Mirrors the rate-sort handling.
        return sumSpend;
      case "creator":
        return users.name;
    }
  }
  const [scope, metric] = key.split(".") as [string, MetricKey];
  if (scope === "total") {
    switch (metric) {
      case "spend":
        return sumSpend;
      case "impressions":
        return sumImpressions;
      case "clicks":
        return sumClicks;
      case "conversions":
        return sumConversions;
      case "ctr":
        return ctr;
      case "cpm":
        return cpm;
      case "cpc":
        return cpc;
      case "cpa":
        return cpa;
      case "roas":
        return roas;
      case "hook_rate":
        return hookRate;
      case "hold_rate":
        return holdRate;
      case "complete_rate":
        return completeRate;
      case "landing_page_views":
        return sumLandingPageViews;
      case "voc":
        return voc;
      case "cvr":
        return cvr;
    }
  }
  const platformMeta = metricsByPlatform.get(scope as Platform);
  if (!platformMeta) return sumSpend;
  switch (metric) {
    case "spend":
      return platformMeta.spend;
    case "impressions":
      return platformMeta.impressions;
    case "clicks":
      return platformMeta.clicks;
    case "conversions":
      return platformMeta.conversions;
    case "ctr":
      return platformMeta.ctr;
    case "cpm":
      return platformMeta.cpm;
    case "cpc":
      return platformMeta.cpc;
    case "cpa":
      return platformMeta.cpa;
    case "roas":
      return platformMeta.roas;
    case "hook_rate":
      return platformMeta.hookRate;
    case "hold_rate":
      return platformMeta.holdRate;
    case "complete_rate":
      return platformMeta.completeRate;
    case "landing_page_views":
      return platformMeta.landingPageViews;
    case "voc":
      return platformMeta.voc;
    case "cvr":
      return platformMeta.cvr;
  }
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

/**
 * Read a metric off a metric block in the SAME units the user sees and
 * filters in. Percentage metrics are stored as ratios (0.0275) but
 * displayed as percentage points (2.75), so we ×100 before comparing —
 * that way "CTR ≥ 2" means 2%, matching the table.
 */
function comparable(
  block: PlatformMetricBlock,
  metric: MetricColumnKey,
): number | null {
  let raw: number | null;
  switch (metric) {
    case "spend":
      raw = block.spend;
      break;
    case "impressions":
      raw = block.impressions;
      break;
    case "clicks":
      raw = block.clicks;
      break;
    case "conversions":
      raw = block.conversions;
      break;
    case "ctr":
      raw = block.ctr;
      break;
    case "cpm":
      raw = block.cpm;
      break;
    case "cpc":
      raw = block.cpc;
      break;
    case "cpa":
      raw = block.cpa;
      break;
    case "roas":
      raw = block.roas;
      break;
    case "hook_rate":
      raw = block.hookRate;
      break;
    case "hold_rate":
      raw = block.holdRate;
      break;
    case "complete_rate":
      raw = block.completeRate;
      break;
    case "landing_page_views":
      raw = block.landingPageViews;
      break;
    case "voc":
      raw = block.voc;
      break;
    case "cvr":
      raw = block.cvr;
      break;
    default:
      raw = null;
  }
  if (raw === null || raw === undefined) return null;
  return METRIC_META[metric].unit === "pct" ? raw * 100 : raw;
}

/**
 * Does a creative satisfy every metric filter? Each filter targets either
 * the blended total or one platform's block (per the rule's scope). A null
 * value — or a scope referencing a platform that isn't in this result —
 * never passes a numeric comparison.
 */
function passesMetricFilters(
  row: SummaryRow,
  filters: MetricFilterCondition[],
): boolean {
  return filters.every((f) => {
    const block =
      f.scope === "total"
        ? row.total
        : row.perPlatform[f.scope as Platform];
    if (!block) return false;
    const v = comparable(block, f.metric);
    if (v === null) return false;
    switch (f.op) {
      case "gte":
        return v >= f.value;
      case "lte":
        return v <= f.value;
      case "eq":
        // Exact float equality essentially never matches a weighted ratio
        // (CTR = 2.7491…), so compare at the 2-dp display precision: "= 2"
        // matches a value rendered as 2.00.
        return Math.round(v * 100) === Math.round(f.value * 100);
    }
  });
}


/**
 * The Summary view's single query. Returns one row per creative with every
 * selected platform's metric block pivoted into columns plus a blended
 * total across the selected platforms.
 *
 * Aggregation rules (all enforced by lib/metrics.ts fragments):
 *   - Per-platform sums use `SUM(col) FILTER (WHERE platform = X)`.
 *   - Per-platform ratios divide that platform's own sums (NOT averages
 *     of per-row ratios).
 *   - The blended `total` block uses the canonical `lib/metrics.ts`
 *     fragments which apply the same weighted formula across all the rows
 *     that survived the JOIN — and the JOIN restricts to the selected
 *     platforms, so the totals are correctly scoped.
 *
 * Filtering:
 *   - `from`/`to` date range and platform filter are applied to
 *     performance_records via the LEFT JOIN's ON clause. This preserves
 *     creatives that have NO matching records in the window (they render
 *     with zero/null metrics rather than disappearing).
 *   - `excluded_from_aggregates = false` (default) likewise lives on the
 *     JOIN so excluded rows fall out of the sums without dropping the
 *     creative entirely.
 *   - Creative-side filters (product, type, status, creator, tags,
 *     search-q) go in the WHERE clause where they should.
 *
 * Tags are loaded in a separate small query and merged in JS to avoid the
 * row-explosion from joining `creative_tags` (which would multiply rows
 * by the number of tags per creative and inflate every SUM).
 */
export async function listCreativeSummary(
  filters: SummaryFilterInput,
): Promise<SummaryResult> {
  const selectedPlatforms: Platform[] =
    filters.platforms && filters.platforms.length > 0
      ? filters.platforms.slice(0, 5)
      : [];

  const resolved = resolveSort(filters.sort, filters.dir, selectedPlatforms);

  // Pre-build per-platform metric fragments once so the SELECT and the
  // ORDER BY share the same expressions.
  const metricsByPlatform = new Map<Platform, ReturnType<typeof platformMetrics>>();
  for (const pf of selectedPlatforms) {
    metricsByPlatform.set(pf, platformMetrics(pf));
  }

  // -------- JOIN clauses on performance_records --------
  // NB: deliberately NOT filtered by platform. The blended Total must always be
  // every platform's combined figure regardless of which per-platform columns
  // are shown, and each per-platform block isolates its own platform via a
  // FILTER aggregate (scopedMetrics). So a creative that ran on a hidden
  // platform still contributes to its Total. Platform selection only controls
  // which per-platform *columns* are emitted (the SELECT loop below).
  const joinConds: SQL[] = [eq(performanceRecords.creativeId, creatives.id)];
  if (filters.from && filters.to) {
    joinConds.push(between(performanceRecords.date, filters.from, filters.to));
  }
  if (!filters.includeExcluded) {
    joinConds.push(eq(performanceRecords.excludedFromAggregates, false));
  }

  // -------- WHERE clauses on creatives --------
  const acct = await getActiveAccountId();
  const whereConds: SQL[] = [eq(creatives.accountId, acct)];
  if (filters.q) {
    whereConds.push(ilike(creatives.name, `%${filters.q}%`));
  }
  if (filters.productIds && filters.productIds.length > 0) {
    whereConds.push(inArray(creatives.productId, filters.productIds));
  }
  if (filters.types && filters.types.length > 0) {
    whereConds.push(inArray(creatives.type, filters.types));
  }
  if (filters.creatorIds && filters.creatorIds.length > 0) {
    whereConds.push(inArray(creatives.createdByUserId, filters.creatorIds));
  }
  if (filters.tags && filters.tags.length > 0) {
    // Restrict to creatives that have at least one of the named tags.
    // EXISTS keeps it as a row-level predicate so we don't fan-out on the
    // join (which would inflate aggregates).
    whereConds.push(
      sql`EXISTS (
        SELECT 1 FROM ${creativeTags}
        WHERE ${creativeTags.creativeId} = ${creatives.id}
          AND ${creativeTags.tag} = ANY(${filters.tags})
      )`,
    );
  }

  // -------- Build the SELECT projection dynamically --------
  // Identity + total (blended) columns are constant. Per-platform columns
  // are emitted only for the selected platforms.
  const select: Record<string, PgColumn | SQL<unknown>> = {
    creativeId: creatives.id,
    name: creatives.name,
    productId: products.id,
    productName: products.name,
    type: creatives.type,
    creatorName: users.name,
    creatorEmail: users.email,
    // Blended totals — canonical lib/metrics fragments over ALL platforms (the
    // JOIN is intentionally not platform-filtered), so the Total is the combined
    // figure across every platform regardless of which per-platform columns are
    // shown.
    totalSpend: sumSpend,
    totalImpressions: sumImpressions,
    totalClicks: sumClicks,
    totalConversions: sumConversions,
    totalConversionValue: sumConversionValue,
    totalCtr: ctr,
    totalCpm: cpm,
    totalCpc: cpc,
    totalCpa: cpa,
    totalRoas: roas,
    totalHookRate: hookRate,
    totalHoldRate: holdRate,
    totalCompleteRate: completeRate,
    totalLandingPageViews: sumLandingPageViews,
    totalVoc: voc,
    totalCvr: cvr,
  };
  for (const pf of selectedPlatforms) {
    const m = metricsByPlatform.get(pf)!;
    select[`${pf}_spend`] = m.spend;
    select[`${pf}_impressions`] = m.impressions;
    select[`${pf}_clicks`] = m.clicks;
    select[`${pf}_conversions`] = m.conversions;
    select[`${pf}_conversionValue`] = m.conversionValue;
    select[`${pf}_ctr`] = m.ctr;
    select[`${pf}_cpm`] = m.cpm;
    select[`${pf}_cpc`] = m.cpc;
    select[`${pf}_cpa`] = m.cpa;
    select[`${pf}_roas`] = m.roas;
    select[`${pf}_hookRate`] = m.hookRate;
    select[`${pf}_holdRate`] = m.holdRate;
    select[`${pf}_completeRate`] = m.completeRate;
    select[`${pf}_landingPageViews`] = m.landingPageViews;
    select[`${pf}_voc`] = m.voc;
    select[`${pf}_cvr`] = m.cvr;
  }

  // Rating AND the dynamic general status are derived in JS (not SQL), so
  // neither a rate sort nor a status sort can be expressed in ORDER BY. Detect
  // them, give SQL a neutral stable order, and re-sort the materialized rows
  // below.
  const isRateSort = resolved.key.endsWith(".rate");
  const isStatusSort = resolved.key === "status";
  // Per-platform status sort ("<platform>.status") — derived in JS like rate
  // and the general status, so SQL only needs a neutral base order.
  const isPlatformStatusSort = resolved.key.endsWith(".status");
  const isIdentitySort = IDENTITY_SORT_KEYS.has(resolved.key);
  const baseOrderExpr =
    isRateSort || isStatusSort || isPlatformStatusSort
      ? sumSpend
      : orderBySql(resolved.key, selectedPlatforms, metricsByPlatform);
  // Null metrics must sort as 0 globally (a creative with no clicks has cpc =
  // "—"; it should sort at the 0 position, not jump to the very top/bottom that
  // Postgres' default NULLS FIRST/LAST would give). Identity (text) columns and
  // the rate/status-sort base order are left untouched.
  const orderExpr =
    isRateSort || isIdentitySort
      ? baseOrderExpr
      : sql`coalesce(${baseOrderExpr}, 0)`;

  const rawRows = await db
    .select(select)
    .from(creatives)
    .innerJoin(products, eq(products.id, creatives.productId))
    .leftJoin(users, eq(users.id, creatives.createdByUserId))
    .leftJoin(performanceRecords, and(...joinConds))
    .where(whereConds.length > 0 ? and(...whereConds) : undefined)
    .groupBy(
      creatives.id,
      creatives.name,
      products.id,
      products.name,
      creatives.type,
      users.name,
      users.email,
    )
    .orderBy(
      // For a rate or status sort, SQL just provides a stable base order
      // (spend desc); the JS re-sort below applies the real rating/status order.
      isRateSort || isStatusSort || isPlatformStatusSort || resolved.dir === "desc"
        ? desc(orderExpr)
        : asc(orderExpr),
      // Stable secondary sort so equal-spend rows don't shuffle between
      // requests.
      asc(creatives.name),
    );

  if (rawRows.length === 0) {
    return { rows: [], platforms: selectedPlatforms, effectiveSort: resolved };
  }

  // Tags — second query, merged in JS.
  const ids = rawRows.map((r) => (r as unknown as { creativeId: string }).creativeId);
  const tagRows = await db
    .select({
      creativeId: creativeTags.creativeId,
      tag: creativeTags.tag,
    })
    .from(creativeTags)
    .where(inArray(creativeTags.creativeId, ids))
    .orderBy(asc(creativeTags.tag));
  const tagsByCreative = new Map<string, string[]>();
  for (const t of tagRows) {
    const list = tagsByCreative.get(t.creativeId) ?? [];
    list.push(t.tag);
    tagsByCreative.set(t.creativeId, list);
  }

  // Dynamic status (general + per-platform), keyed by creativeId. Account-scoped
  // internally; restricted to the visible creatives so the status query matches
  // the page. A creative absent from the map = "new" (see statusFor).
  const sMap = await creativeStatusMap(ids);

  // Reshape — pull each row's per-platform fields into a nested block.
  const rows: SummaryRow[] = rawRows.map((row) => {
    const r = row as unknown as Record<string, unknown>;
    const perPlatform: Partial<Record<Platform, PlatformMetricBlock>> = {};
    for (const pf of selectedPlatforms) {
      perPlatform[pf] = {
        spend: num(r[`${pf}_spend`]),
        impressions: num(r[`${pf}_impressions`]),
        clicks: num(r[`${pf}_clicks`]),
        conversions: numOrNull(r[`${pf}_conversions`]),
        conversionValue: numOrNull(r[`${pf}_conversionValue`]),
        ctr: numOrNull(r[`${pf}_ctr`]),
        cpm: numOrNull(r[`${pf}_cpm`]),
        cpc: numOrNull(r[`${pf}_cpc`]),
        cpa: numOrNull(r[`${pf}_cpa`]),
        roas: numOrNull(r[`${pf}_roas`]),
        hookRate: numOrNull(r[`${pf}_hookRate`]),
        holdRate: numOrNull(r[`${pf}_holdRate`]),
        completeRate: numOrNull(r[`${pf}_completeRate`]),
        landingPageViews: num(r[`${pf}_landingPageViews`]),
        voc: numOrNull(r[`${pf}_voc`]),
        cvr: numOrNull(r[`${pf}_cvr`]),
      };
    }
    const dyn = statusFor(sMap, r.creativeId as string);
    return {
      creativeId: r.creativeId as string,
      name: r.name as string,
      productId: r.productId as string,
      productName: r.productName as string,
      type: r.type as CreativeType,
      generalStatus: dyn.general,
      perPlatformStatus: dyn.perPlatform,
      creatorName: (r.creatorName as string | null) ?? null,
      creatorEmail: (r.creatorEmail as string | null) ?? null,
      tags: tagsByCreative.get(r.creativeId as string) ?? [],
      perPlatform,
      total: {
        spend: num(r.totalSpend),
        impressions: num(r.totalImpressions),
        clicks: num(r.totalClicks),
        conversions: numOrNull(r.totalConversions),
        conversionValue: numOrNull(r.totalConversionValue),
        ctr: numOrNull(r.totalCtr),
        cpm: numOrNull(r.totalCpm),
        cpc: numOrNull(r.totalCpc),
        cpa: numOrNull(r.totalCpa),
        roas: numOrNull(r.totalRoas),
        hookRate: numOrNull(r.totalHookRate),
        holdRate: numOrNull(r.totalHoldRate),
        completeRate: numOrNull(r.totalCompleteRate),
        landingPageViews: num(r.totalLandingPageViews),
        voc: numOrNull(r.totalVoc),
        cvr: numOrNull(r.totalCvr),
      },
    };
  });

  // A filter (metric / rate / status) can carry a platform scope that's no
  // longer in the current platform selection — e.g. a saved view or edited URL
  // pinned `snapchat:roas` while the view now shows only IG/TikTok. That platform
  // has no metric block, so the filter would silently drop EVERY row and the
  // table looks broken. Ignore any filter whose scope isn't "total" or a
  // currently-selected platform rather than zeroing the result set.
  const scopeOk = (scope: string) =>
    scope === "total" || selectedPlatforms.includes(scope as Platform);

  // Numeric metric filters — applied in-memory against each creative's
  // blended total. There's no LIMIT on this query, so post-aggregation
  // filtering is exactly equivalent to a HAVING clause but far simpler to
  // express against the dynamic per-selection total expressions. Sort order
  // from SQL is preserved because we only drop rows.
  const activeMetricFilters = (filters.metricFilters ?? []).filter((f) =>
    scopeOk(f.scope),
  );
  let filteredRows =
    activeMetricFilters.length > 0
      ? rows.filter((r) => passesMetricFilters(r, activeMetricFilters))
      : rows;

  // Rating-based filter + sort (both derived from spend/ROAS in JS). Each
  // scope resolves to its own rules — a platform's override, else the default.
  const config = filters.ratingConfig ?? DEFAULT_RATING_CONFIG;
  const blockFor = (row: SummaryRow, scope: string) =>
    scope === "total" ? row.total : row.perPlatform[scope as Platform];

  const rate = filters.rateFilter;
  if (rate && rate.ratings.length > 0 && scopeOk(rate.scope)) {
    const want = new Set(rate.ratings);
    filteredRows = filteredRows.filter((r) =>
      want.has(rateBlock(blockFor(r, rate.scope), rulesForScope(config, rate.scope))),
    );
  }

  // Dynamic-status filter — same row-dropping shape as the rate filter. Scope
  // "total" tests the general roll-up; a platform scope tests that platform's
  // per-platform status. Per-platform "new" is NEVER a stored status — it's the
  // ABSENCE of presence on that platform — so an undefined platform status maps
  // to "new", matching what the cell shows and how the column sorts. (Without
  // this, filtering "new" on a platform could never match anything.)
  const status = filters.statusFilter;
  if (status && status.statuses.length > 0 && scopeOk(status.scope)) {
    const want = new Set<DynamicCreativeStatus>(status.statuses);
    filteredRows = filteredRows.filter((r) => {
      const s: DynamicCreativeStatus =
        status.scope === "total"
          ? r.generalStatus
          : (r.perPlatformStatus[status.scope as Platform] ?? "new");
      return want.has(s);
    });
  }

  if (isRateSort) {
    const [scope] = resolved.key.split(".");
    const factor = resolved.dir === "asc" ? 1 : -1;
    // Copy before sorting so the SQL-ordered `rows` isn't mutated in place
    // when no row-dropping filter ran (filteredRows may alias rows).
    filteredRows = [...filteredRows].sort((a, b) => {
      const ra = RATING_RANK[rateBlock(blockFor(a, scope!), rulesForScope(config, scope!))];
      const rb = RATING_RANK[rateBlock(blockFor(b, scope!), rulesForScope(config, scope!))];
      if (ra !== rb) return (ra - rb) * factor;
      return a.name.localeCompare(b.name);
    });
  }

  // Dynamic general-status sort — same JS re-sort shape as the rate sort, but
  // ordered by STATUS_ORDER over each row's derived generalStatus (the legacy
  // SQL column is gone). Copy before sorting so the SQL-ordered rows aren't
  // mutated in place when filteredRows aliases rows.
  if (isStatusSort) {
    const factor = resolved.dir === "asc" ? 1 : -1;
    filteredRows = [...filteredRows].sort((a, b) => {
      const sa = STATUS_ORDER[a.generalStatus];
      const sb = STATUS_ORDER[b.generalStatus];
      if (sa !== sb) return (sa - sb) * factor;
      return a.name.localeCompare(b.name);
    });
  }

  // Per-platform status sort — ranks by that platform's status (STATUS_ORDER),
  // treating "no presence on the platform" as New to match what the cell shows.
  if (isPlatformStatusSort) {
    const [scope] = resolved.key.split(".");
    const factor = resolved.dir === "asc" ? 1 : -1;
    filteredRows = [...filteredRows].sort((a, b) => {
      const sa = STATUS_ORDER[a.perPlatformStatus[scope as Platform] ?? "new"];
      const sb = STATUS_ORDER[b.perPlatformStatus[scope as Platform] ?? "new"];
      if (sa !== sb) return (sa - sb) * factor;
      return a.name.localeCompare(b.name);
    });
  }

  return {
    rows: filteredRows,
    platforms: selectedPlatforms,
    effectiveSort: resolved,
  };
}
