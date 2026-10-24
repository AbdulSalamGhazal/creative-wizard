import { cache } from "react";
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
  campaigns,
  creatives,
  creativeAngles,
  landingPages,
  performanceRecords,
  products,
  angles,
  users,
  platformEnum,
  type creativeTypeEnum,
} from "@/db/schema";
import type { CreativeSort } from "@/validators/creative";
import { getActiveAccountId } from "@/lib/tenant";
import { creativeStatusMap, statusFor } from "@/db/queries/creative-status";
import { sortCreativeRows } from "@/lib/creative-sort";
import {
  statusBreakdownOf,
  type CreativeStatusResult,
  type CreativeStatus,
  type CreativeStatusBreakdown,
} from "@/lib/creative-status";
import { splitPriorityFilter } from "@/lib/priority";
import { sortStages, splitStageFilter } from "@/lib/funnel-stages";

type CreativeType = (typeof creativeTypeEnum)[number];
type Platform = (typeof platformEnum)[number];

export interface CreativeListFilters {
  q?: string;
  productIds?: string[];
  types?: CreativeType[];
  statuses?: CreativeStatus[] | undefined;
  /** Keep only creatives with ≥1 performance record on these platforms. */
  platforms?: Platform[];
  angles?: string[];
  /** Priority filter tokens: "3" | "2" | "1" | "unrated". */
  priorities?: string[];
  /** Stage filter tokens: a FUNNEL_STAGES value, or "unassigned". OVERLAP. */
  stages?: string[];
  sort: CreativeSort;
  limit?: number;
  /** Count excluded records into the 7d/30d spend windows (default: hidden). */
  includeExcluded?: boolean;
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
  angles: string[];
  spend7d: number;
  spend30d: number;
  /** Manual Priority (1..3, 3 = highest); null = unrated. */
  priority: number | null;
  /** Manual funnel stage(s), in funnel order; empty = unassigned. */
  stages: string[];
  notes: string | null;
  sourceLink: string | null;
  /** Display name of the creator (joined from `users`), null if unresolvable. */
  createdByName: string | null;
  createdAt: Date;
}

export interface CreativeListResult {
  rows: CreativeListRow[];
  totalMatching: number;
  /**
   * The status FACET for the strip above the table: counts across the rows
   * this call matched, with the STATUS filter itself deliberately left out
   * (selecting "Active" must not zero the other chips). Computed here, from
   * the pre-status-filter rows, so it costs nothing and can never disagree
   * with the table — never re-derive it with a second query.
   */
  breakdown: CreativeStatusBreakdown;
}


/**
 * The WHERE of the Library listing — shared by `listCreatives` and the detail
 * page's pager (`listCreativeSequence`), so the two always match the SAME
 * creatives. Status is not here: it's derived, and filtered in JS after.
 */
function creativeListConditions(filters: CreativeListFilters, acct: string): SQL[] {
  const conditions: SQL[] = [eq(creatives.accountId, acct)];

  if (filters.q) {
    const pattern = `%${filters.q}%`;
    conditions.push(
      or(
        ilike(creatives.name, pattern),
        ilike(creatives.notes, pattern),
        sql`EXISTS (SELECT 1 FROM ${creativeAngles} ct
                    WHERE ct.creative_id = ${creatives.id}
                      AND ct.angle ILIKE ${pattern})`,
      )!,
    );
  }
  if (filters.productIds && filters.productIds.length > 0) {
    conditions.push(inArray(creatives.productId, filters.productIds));
  }
  if (filters.types && filters.types.length > 0) {
    conditions.push(inArray(creatives.type, filters.types));
  }
  // NOTE: status is no longer a DB column we read — it's derived dynamically
  // (see creativeStatusMap below) and filtered in JS after attaching.
  if (filters.angles && filters.angles.length > 0) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${creativeAngles} ct
                  WHERE ct.creative_id = ${creatives.id}
                    AND ct.angle IN ${filters.angles})`,
    );
  }
  if (filters.priorities && filters.priorities.length > 0) {
    const { numbers, unrated } = splitPriorityFilter(filters.priorities);
    const wanted: SQL[] = [];
    if (numbers.length > 0) wanted.push(inArray(creatives.priority, numbers));
    // "Unrated" is a selectable value, so it has to match NULL explicitly —
    // `IN (…)` never matches a NULL.
    if (unrated) wanted.push(sql`${creatives.priority} IS NULL`);
    if (wanted.length > 0) conditions.push(wanted.length === 1 ? wanted[0]! : or(...wanted)!);
  }
  if (filters.stages && filters.stages.length > 0) {
    const { stages, unassigned } = splitStageFilter(filters.stages);
    const wanted: SQL[] = [];
    // OVERLAP: a creative matches if ANY selected stage is on it. `&&` is what
    // the GIN index on the column serves.
    if (stages.length > 0) {
      wanted.push(sql`${creatives.stages} && ${sql.param(stages)}::text[]`);
    }
    // "Unassigned" is a selectable value — an empty array, not a NULL.
    if (unassigned) wanted.push(sql`cardinality(${creatives.stages}) = 0`);
    if (wanted.length > 0) conditions.push(wanted.length === 1 ? wanted[0]! : or(...wanted)!);
  }
  // The platform filter NEVER narrows the list (one platform or several). It
  // only scopes the status (and the 7d/30d spend columns) to the selected
  // platform(s): every creative still shows, and its status becomes the roll-up
  // over just those platforms — New where it never ran on any of them. See
  // `effectiveStatusOf` below.
  return conditions;
}

/**
 * Recent-spend window CTE. Built via the query builder (not a raw subquery) so
 * the platform predicate binds safely through `inArray`. It respects the
 * platform filter so the 7d/30d columns reflect what's actually filtered
 * (without it they summed every platform). The interval is inlined from a
 * trusted integer.
 */
function spendWindowCte(filters: CreativeListFilters, alias: string, days: number, acct: string) {
  const conds: SQL[] = [
    // Account is already enforced by the creative_id join to the
    // account-scoped `creatives`; stating it HERE too lets the CTE use the
    // (account_id, …) index instead of scanning every brand's rows first.
    eq(performanceRecords.accountId, acct),
    sql`${performanceRecords.date} >= CURRENT_DATE - ${sql.raw(`INTERVAL '${days} days'`)}`,
  ];
  if (!filters.includeExcluded) {
    conds.push(eq(performanceRecords.excludedFromAggregates, false));
  }
  if (filters.platforms && filters.platforms.length > 0) {
    conds.push(inArray(performanceRecords.platform, filters.platforms));
  }
  return db.$with(alias).as(
    db
      .select({
        creativeId: sql<string>`${performanceRecords.creativeId}`.as("creative_id"),
        spend: sql<string>`SUM(${performanceRecords.spend})`.as("spend"),
      })
      .from(performanceRecords)
      .where(and(...conds))
      .groupBy(performanceRecords.creativeId),
  );
}

/**
 * The shown status, scoped to the SELECTED platforms — for one or several,
 * roll up over just those platforms with the same precedence as the general
 * roll-up (active ▸ pause ▸ new ▸ terminated; a platform the creative never
 * ran on counts as New). No platform selected → the general (all-platform)
 * roll-up. Badge, status filter, and status sort all read this.
 */
function effectiveStatusOf(
  statusMap: Map<string, CreativeStatusResult>,
  scopePlatforms: readonly Platform[],
): (id: string) => CreativeStatus {
  return (id) => {
    const s = statusFor(statusMap, id);
    if (scopePlatforms.length === 0) return s.general;
    let anyActive = false;
    let anyPause = false;
    let anyNew = false;
    for (const p of scopePlatforms) {
      const ps = s.perPlatform[p];
      if (ps === "active") anyActive = true;
      else if (ps === "pause") anyPause = true;
      else if (ps !== "terminated") anyNew = true; // undefined = never ran there
    }
    if (anyActive) return "active";
    if (anyPause) return "pause";
    if (anyNew) return "new";
    return "terminated";
  };
}

/** Does this sort read the 7d / 30d spend windows? */
const isSpendSort = (sort: CreativeSort) => sort.startsWith("spend");

/**
 * Library list with all filter support. Uses two CTEs (spend windows) and an
 * account-scoped angle CTE so the spend and angle list join per-creative
 * without fan-out.
 *
 * ORDER is the shared pure comparator (`sortCreativeRows`, lib/creative-sort),
 * not SQL — the client re-sorts the rows it holds with the SAME function when
 * a sort is clicked (D12), and the detail page's pager uses it too (W2-4).
 *
 * Search (q) is ILIKE across name, notes, and joined angles. For the seeded
 * dataset (< 10 rows) this is fine; revisit pg_trgm + GIN once N > 10k or
 * p95 > 100 ms.
 */
export async function listCreatives(
  filters: CreativeListFilters,
): Promise<CreativeListResult> {
  const acct = await getActiveAccountId();
  const spend30d = spendWindowCte(filters, "spend_30d", 30, acct);
  const spend7d = spendWindowCte(filters, "spend_7d", 7, acct);

  // Scoped to the brand (W2-4): it used to aggregate EVERY brand's angles and
  // throw the other brands' away at the join.
  const angleAgg = db.$with("angle_agg").as(
    db
      .select({
        creativeId: creativeAngles.creativeId,
        angles: sql<string[]>`array_agg(${creativeAngles.angle} ORDER BY ${creativeAngles.angle})`.as(
          "angles",
        ),
      })
      .from(creativeAngles)
      .innerJoin(creatives, eq(creatives.id, creativeAngles.creativeId))
      .where(eq(creatives.accountId, acct))
      .groupBy(creativeAngles.creativeId),
  );

  const conditions = creativeListConditions(filters, acct);

  // Qualify CTE columns explicitly — both spend CTEs expose `creative_id` and
  // `spend`, so unqualified refs are ambiguous once both are joined.
  const spendAlias = sql<string | null>`spend_30d.spend`.as("spend_30d");
  const spend7Alias = sql<string | null>`spend_7d.spend`.as("spend_7d");
  const anglesAlias = sql<string[] | null>`${angleAgg.angles}`.as("angle_list");

  // Every matching creative (the page wraps the grid / table in an internal
  // vertical scroll, like Summary): no SQL LIMIT, because the order is
  // decided in JS below and the status filter runs in JS too.
  const rows = await db
    .with(spend30d, spend7d, angleAgg)
    .select({
      id: creatives.id,
      name: creatives.name,
      productId: creatives.productId,
      productName: products.name,
      type: creatives.type,
      thumbnailUrl: creatives.thumbnailUrl,
      launchDate: creatives.launchDate,
      angles: anglesAlias,
      spend7d: spend7Alias,
      spend30d: spendAlias,
      // Export-only fields (the on-screen table renders the same columns as
      // before) — the Library CSV exports the creative's full data.
      priority: creatives.priority,
      stages: creatives.stages,
      notes: creatives.notes,
      sourceLink: creatives.sourceLink,
      createdAt: creatives.createdAt,
      createdByName: users.name,
    })
    .from(creatives)
    .innerJoin(products, eq(products.id, creatives.productId))
    // LEFT join (not inner) so a creative can never drop out of the Library if
    // its creator row is ever unresolvable. users.id is unique → no fan-out.
    .leftJoin(users, eq(users.id, creatives.createdByUserId))
    .leftJoin(spend30d, sql`spend_30d.creative_id = ${creatives.id}`)
    .leftJoin(spend7d, sql`spend_7d.creative_id = ${creatives.id}`)
    .leftJoin(angleAgg, eq(angleAgg.creativeId, creatives.id))
    .where(and(...conditions));

  // Attach the dynamic, derived status to every row (account-scoped, batched).
  // No id list: the map is derived from the request's shared status inputs,
  // and every read below is a keyed lookup — passing hundreds of ids only
  // added an `IN (…)` list (and, before the shared inputs, a whole extra scan).
  const effectiveStatus = effectiveStatusOf(await creativeStatusMap(), filters.platforms ?? []);

  let mapped: CreativeListRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    productId: r.productId,
    productName: r.productName,
    type: r.type as CreativeType,
    status: effectiveStatus(r.id),
    thumbnailUrl: r.thumbnailUrl,
    launchDate: r.launchDate,
    angles: r.angles ?? [],
    spend7d: r.spend7d === null ? 0 : Number(r.spend7d),
    spend30d: r.spend30d === null ? 0 : Number(r.spend30d),
    priority: r.priority,
    // Stored unordered; presented in funnel order so every surface agrees.
    stages: sortStages(r.stages ?? []),
    notes: r.notes,
    sourceLink: r.sourceLink,
    createdByName: r.createdByName,
    createdAt: r.createdAt,
  }));

  // The status FACET for the strip, taken HERE — after every other filter has
  // been applied and the status attached, but BEFORE the status filter narrows
  // `mapped` below. That ordering is the whole behaviour: the chips keep their
  // counts when one of them is selected.
  const breakdown = statusBreakdownOf(mapped);

  // Status filter runs in JS, AFTER status is attached — the dynamic status
  // isn't a DB column, so it can't be a SQL WHERE. It matches the EFFECTIVE
  // (platform-scoped when one platform is selected) status. The Library shows
  // all matching rows (no real pagination), so JS filtering is exact.
  if (filters.statuses?.length) {
    const allowed = new Set(filters.statuses);
    mapped = mapped.filter((row) => allowed.has(row.status));
  }

  mapped = sortCreativeRows(mapped, filters.sort);
  const totalMatching = mapped.length;
  const finalRows = filters.limit ? mapped.slice(0, filters.limit) : mapped;
  return { rows: finalRows, totalMatching, breakdown };
}

/**
 * The Library's ordered NAMES for a filter set — what the detail page's
 * prev/next pager walks (W2-4, 2026-10). It used to call `listCreatives`, the
 * Library's heaviest query (two spend-window CTEs over performance_records,
 * every brand's angles, notes, creators) on every detail view and every
 * prev/next step, to read one column. This reads only what the filters and
 * the sort need: the spend windows only for a spend sort, the angle list only
 * for an angle sort, and the status from the request's cached inputs. Same
 * WHERE (`creativeListConditions`), same comparator (`sortCreativeRows`), so
 * the sequence is the Library's exactly.
 */
export async function listCreativeSequence(filters: CreativeListFilters): Promise<string[]> {
  const acct = await getActiveAccountId();
  const conditions = creativeListConditions(filters, acct);
  const wantsSpend = isSpendSort(filters.sort);
  const wantsAngles = filters.sort === "angle-asc" || filters.sort === "angle-desc";

  const columns = {
    id: creatives.id,
    name: creatives.name,
    productName: products.name,
    type: creatives.type,
    launchDate: creatives.launchDate,
    priority: creatives.priority,
    stages: creatives.stages,
    createdAt: creatives.createdAt,
    angles: wantsAngles
      ? sql<string[]>`ARRAY(SELECT ${creativeAngles.angle} FROM ${creativeAngles} WHERE ${creativeAngles.creativeId} = ${creatives.id})`
      : sql<string[]>`'{}'::text[]`,
  };

  let rows: Array<{
    id: string;
    name: string;
    productName: string;
    type: string;
    launchDate: string | null;
    priority: number | null;
    stages: string[] | null;
    createdAt: Date;
    angles: string[];
    spend7d?: string | null;
    spend30d?: string | null;
  }>;
  if (wantsSpend) {
    const spend30d = spendWindowCte(filters, "spend_30d", 30, acct);
    const spend7d = spendWindowCte(filters, "spend_7d", 7, acct);
    rows = await db
      .with(spend30d, spend7d)
      .select({
        ...columns,
        spend7d: sql<string | null>`spend_7d.spend`.as("spend_7d"),
        spend30d: sql<string | null>`spend_30d.spend`.as("spend_30d"),
      })
      .from(creatives)
      .innerJoin(products, eq(products.id, creatives.productId))
      .leftJoin(spend30d, sql`spend_30d.creative_id = ${creatives.id}`)
      .leftJoin(spend7d, sql`spend_7d.creative_id = ${creatives.id}`)
      .where(and(...conditions));
  } else {
    rows = await db
      .select(columns)
      .from(creatives)
      .innerJoin(products, eq(products.id, creatives.productId))
      .where(and(...conditions));
  }

  const needsStatus = Boolean(filters.statuses?.length) || filters.sort.startsWith("status");
  const effectiveStatus = needsStatus
    ? effectiveStatusOf(await creativeStatusMap(), filters.platforms ?? [])
    : () => "new" as CreativeStatus;
  let seq = rows.map((r) => ({
    name: r.name,
    productName: r.productName,
    type: r.type,
    status: effectiveStatus(r.id),
    launchDate: r.launchDate,
    angles: r.angles ?? [],
    spend7d: r.spend7d == null ? 0 : Number(r.spend7d),
    spend30d: r.spend30d == null ? 0 : Number(r.spend30d),
    priority: r.priority,
    stages: r.stages ?? [],
    createdAt: r.createdAt,
  }));
  if (filters.statuses?.length) {
    const allowed = new Set(filters.statuses);
    seq = seq.filter((row) => allowed.has(row.status));
  }
  return sortCreativeRows(seq, filters.sort).map((r) => r.name);
}

// (Library header stats now come from creativeStatusBreakdown() in
// db/queries/creative-status.ts — a single status-map pass with the general +
// per-platform breakdown.)

// -----------------------------------------------------------------------------
// Creative Detail queries
// -----------------------------------------------------------------------------

/**
 * Detail-page identity fields. Status is NOT here — it's derived dynamically:
 * the page computes `creativeStatusMap([id])` + `terminatedPlatformsFor(id)`
 * and passes the result to the header.
 */
export interface CreativeDetail {
  id: string;
  name: string;
  productId: string;
  productName: string;
  type: CreativeType;
  thumbnailUrl: string | null;
  launchDate: string | null;
  /** Manual Priority (1..3, 3 = highest); null = unrated. Distinct from Rate. */
  priority: number | null;
  /** Manual funnel stage(s), in funnel order; empty = unassigned. */
  stages: string[];
  notes: string | null;
  sourceLink: string | null;
  createdAt: Date;
  updatedAt: Date;
  angles: string[];
}

/**
 * `cache()`-wrapped so the detail page and its `generateMetadata` (which needs
 * the name for the tab title) share ONE fetch per request instead of querying
 * twice. Mirrors the dedupe pattern in lib/tenant.ts / lib/auth.ts.
 */
/** One ⌘K row: a creative to jump to, labelled with its product. */
export interface CreativeOption {
  id: string;
  name: string;
  productName: string;
}

/**
 * Every creative of the active brand as a picker option (id, name, product),
 * by name — the ONE creative-options read (W3-8: the ⌘K list, the cleanup
 * tool's and the exclusion rules' pickers each used to write it inline).
 * The ⌘K palette fetches it through `GET /api/palette` when first opened (D13)
 * and passes `limit` (500, more than the team's catalog) so its payload stays
 * bounded; a picker that must offer every creative passes none.
 */
export async function listCreativeOptions(
  opts: { limit?: number } = {},
): Promise<CreativeOption[]> {
  const acct = await getActiveAccountId();
  const q = db
    .select({ id: creatives.id, name: creatives.name, productName: products.name })
    .from(creatives)
    .innerJoin(products, eq(products.id, creatives.productId))
    .where(eq(creatives.accountId, acct))
    .orderBy(asc(creatives.name));
  return opts.limit === undefined ? q : q.limit(opts.limit);
}

export const getCreativeByName = cache(async (
  name: string,
): Promise<CreativeDetail | null> => {
  const acct = await getActiveAccountId();
  const [row] = await db
    .select({
      id: creatives.id,
      name: creatives.name,
      productId: creatives.productId,
      productName: products.name,
      type: creatives.type,
      thumbnailUrl: creatives.thumbnailUrl,
      launchDate: creatives.launchDate,
      priority: creatives.priority,
      stages: creatives.stages,
      notes: creatives.notes,
      sourceLink: creatives.sourceLink,
      createdAt: creatives.createdAt,
      updatedAt: creatives.updatedAt,
      // The angles ride along in the same round trip (W2-4, 2026-10 — they
      // were a second query on every detail view).
      angles: sql<string[]>`ARRAY(SELECT ${creativeAngles.angle} FROM ${creativeAngles} WHERE ${creativeAngles.creativeId} = ${creatives.id} ORDER BY ${creativeAngles.angle})`,
    })
    .from(creatives)
    .innerJoin(products, eq(products.id, creatives.productId))
    .where(and(eq(creatives.accountId, acct), eq(creatives.name, name)))
    .limit(1);

  if (!row) return null;

  return {
    ...row,
    type: row.type as CreativeType,
    // Stored unordered; presented in funnel order so the editor's chips and
    // every table cell agree.
    stages: sortStages(row.stages ?? []),
    angles: row.angles ?? [],
  };
});

export interface CreativeDeletionSummary {
  /** Total performance_records that would be hard-deleted with the creative. */
  records: number;
  /** Per-platform record counts, busiest first. */
  platforms: { platform: Platform; records: number }[];
  /** Distinct campaign_name values across all of this creative's records. */
  campaigns: number;
  /** Earliest / latest record date (YYYY-MM-DD), or null when no records. */
  firstDate: string | null;
  lastDate: string | null;
}

/**
 * Everything hard-deleted alongside a creative. `performance_records` is FK'd
 * to exactly one creative and has NO `ON DELETE CASCADE`, so the delete action
 * removes these rows explicitly inside a transaction — they belong to this
 * creative alone and cannot be attached to any other. Powers the delete
 * confirmation dialog so the user sees exactly what disappears. (Angles DO
 * cascade and aren't counted here.)
 */
export async function creativeDeletionSummary(
  creativeId: string,
): Promise<CreativeDeletionSummary> {
  // Account guard for defence in depth — callers pre-scope the creative id
  // today, but this query must not depend on that (the sibling
  // campaignDeletionSummary carries the same explicit guard).
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      platform: performanceRecords.platform,
      records: sql<number>`COUNT(*)::int`,
      firstDate: sql<string | null>`MIN(${performanceRecords.date})`,
      lastDate: sql<string | null>`MAX(${performanceRecords.date})`,
    })
    .from(performanceRecords)
    .where(
      and(
        eq(performanceRecords.accountId, acct),
        eq(performanceRecords.creativeId, creativeId),
      ),
    )
    .groupBy(performanceRecords.platform);

  let records = 0;
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  const platforms = rows.map((r) => {
    records += r.records;
    if (r.firstDate && (!firstDate || r.firstDate < firstDate)) firstDate = r.firstDate;
    if (r.lastDate && (!lastDate || r.lastDate > lastDate)) lastDate = r.lastDate;
    return { platform: r.platform as Platform, records: r.records };
  });
  platforms.sort((a, b) => b.records - a.records);

  const [agg] = await db
    .select({
      campaigns: sql<number>`COUNT(DISTINCT ${performanceRecords.campaignId})::int`,
    })
    .from(performanceRecords)
    .where(
      and(
        eq(performanceRecords.accountId, acct),
        eq(performanceRecords.creativeId, creativeId),
      ),
    );

  return { records, platforms, campaigns: agg?.campaigns ?? 0, firstDate, lastDate };
}

export interface CreativeRecordRow {
  id: number;
  platform: (typeof platformEnum)[number];
  campaignName: string;
  /** The ` @code` landing page (code without `@`); null = the product's page. */
  landingPageCode: string | null;
  landingPageName: string | null;
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number | null;
  conversionValue: number | null;
  landingPageViews: number | null;
  addToCart: number | null;
  addPayment: number | null;
  videoViews2s: number | null;
  videoViews25: number | null;
  videoViews50: number | null;
  videoViews75: number | null;
  videoViews100: number | null;
  excludedFromAggregates: boolean;
  excludedSource: "manual" | "rule" | null;
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
  // Account guard for defence in depth (see creativeDeletionSummary).
  const acct = await getActiveAccountId();
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
      campaignName: campaigns.name,
      landingPageCode: landingPages.code,
      landingPageName: landingPages.name,
      landingPageViews: performanceRecords.landingPageViews,
      addToCart: performanceRecords.addToCart,
      addPayment: performanceRecords.addPayment,
      videoViews2s: performanceRecords.videoViews2s,
      videoViews25: performanceRecords.videoViews25,
      videoViews50: performanceRecords.videoViews50,
      videoViews75: performanceRecords.videoViews75,
      videoViews100: performanceRecords.videoViews100,
      excludedFromAggregates: performanceRecords.excludedFromAggregates,
      excludedSource: performanceRecords.excludedSource,
      excludedReason: performanceRecords.excludedReason,
      excludedAt: performanceRecords.excludedAt,
    })
    .from(performanceRecords)
    .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
    // A PK join off a column the row already carries — the admission price
    // for a defaultHidden column (docs/decisions/tables-columns.md).
    .leftJoin(landingPages, eq(landingPages.id, performanceRecords.landingPageId))
    .where(
      and(
        eq(performanceRecords.accountId, acct),
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
    landingPageCode: r.landingPageCode,
    landingPageName: r.landingPageName,
    landingPageViews: r.landingPageViews,
    addToCart: r.addToCart,
    addPayment: r.addPayment,
    videoViews2s: r.videoViews2s,
    videoViews25: r.videoViews25,
    videoViews50: r.videoViews50,
    videoViews75: r.videoViews75,
    videoViews100: r.videoViews100,
    excludedFromAggregates: r.excludedFromAggregates,
    excludedSource: r.excludedSource ?? null,
    excludedReason: r.excludedReason,
    excludedAt: r.excludedAt,
  }));
}

/**
 * Angle list for filter dropdowns + creative-form suggestions. Union of the
 * managed vocabulary (`angles`) and any angles currently in use on creatives —
 * so a freshly-added vocabulary angle is selectable immediately, and any
 * legacy ad-hoc assignment still appears until it's curated.
 */
export async function listAllAngles(): Promise<string[]> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      angle: sql<string>`t`,
    })
    .from(
      sql`(
        SELECT ${angles.name} AS t FROM ${angles} WHERE ${angles.accountId} = ${acct}
        UNION
        SELECT ${creativeAngles.angle} AS t FROM ${creativeAngles}
          JOIN ${creatives} ON ${creatives.id} = ${creativeAngles.creativeId}
          WHERE ${creatives.accountId} = ${acct}
      ) AS u`,
    )
    .orderBy(sql`t`);
  return rows.map((r) => r.angle);
}

