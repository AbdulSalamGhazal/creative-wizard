import { and, eq, gt, gte, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaigns,
  creativeAngles,
  creatives,
  parentCampaigns,
  performanceRecords,
  type platformEnum,
} from "@/db/schema";
import { scopedMetrics } from "@/lib/metrics";
import { getActiveAccountId, getActiveStatusWindowHours } from "@/lib/tenant";
import {
  creativeStatusMap,
  platformSpendFreshness,
  statusFor,
} from "@/db/queries/creative-status";
import {
  campaignStatusFor,
  campaignStatusMap,
} from "@/db/queries/campaign-status";
import {
  hoursToWindowDays,
  type CreativeStatus,
  type CreativeStatusResult,
} from "@/lib/creative-status";
import { sortStages, splitStageFilter } from "@/lib/funnel-stages";
import { getRatingConfig } from "@/db/queries/rating";
import {
  CANVAS_MAX_NODES,
  campaignHealth,
  campaignNodeId,
  canvasPairs,
  capEdges,
  creativeNodeId,
  pairVerdict,
  parentNodeId,
  type CanvasCampaignNode,
  type CanvasCreativeNode,
  type CanvasCreativeType,
  type CanvasEdge,
  type CanvasFocusParam,
  type CanvasGraph,
  type CanvasLevel,
  type CanvasScanRow,
  creativeRate,
  earlierDay,
} from "@/lib/canvas";

type Platform = (typeof platformEnum)[number];

export interface CanvasFilters {
  /** RESOLVED bounds — the page resolves the range before calling (the
   *  label-never-lies rule); this query never invents a default. */
  from: string;
  to: string;
  platforms?: Platform[];
  /** Creative statuses to SHOW. Applied in JS — status is derived, not a column. */
  statuses: readonly CreativeStatus[];
  productIds?: string[];
  stages?: string[];
  includeExcluded?: boolean;
  /**
   * What the campaign side holds (2026-11): ad sets (the default) or
   * campaigns — a `parent_campaigns` row with its ad sets folded together.
   */
  level?: CanvasLevel;
}

/** The creative-side filters, shared by the edge scan and the idle lookup so
 *  the two can never disagree about which creatives are in scope. */
function creativeConds(f: CanvasFilters): SQL[] {
  const conds: SQL[] = [];
  if (f.productIds && f.productIds.length > 0) {
    conds.push(inArray(creatives.productId, f.productIds));
  }
  if (f.stages && f.stages.length > 0) {
    const { stages, unassigned } = splitStageFilter(f.stages);
    const wanted: SQL[] = [];
    // OVERLAP — any selected stage on the creative matches (the GIN index).
    if (stages.length > 0) {
      wanted.push(sql`${creatives.stages} && ${sql.param(stages)}::text[]`);
    }
    if (unassigned) wanted.push(sql`cardinality(${creatives.stages}) = 0`);
    if (wanted.length > 0) conds.push(wanted.length === 1 ? wanted[0]! : or(...wanted)!);
  }
  return conds;
}

/**
 * The status a creative shows on the canvas. With no platform filter it is the
 * GENERAL roll-up; with one, it is the roll-up over just the selected
 * platforms (the Library's rule) — otherwise a creative live only on TikTok
 * would read as "active but idle" on an Instagram-filtered canvas, when it is
 * simply filtered out.
 */
function scopedStatus(
  s: CreativeStatusResult,
  platforms: readonly Platform[] | undefined,
): CreativeStatus {
  if (!platforms || platforms.length === 0) return s.general;
  let anyActive = false;
  let anyPause = false;
  let anyNew = false;
  for (const p of platforms) {
    const ps = s.perPlatform[p];
    if (ps === "active") anyActive = true;
    else if (ps === "pause") anyPause = true;
    else if (ps !== "terminated") anyNew = true; // never ran there
  }
  if (anyActive) return "active";
  if (anyPause) return "pause";
  if (anyNew) return "new";
  return "terminated";
}

/**
 * The campaign↔creative graph for a range. READ-ONLY FACTS: an edge exists
 * because a creative SPENT (> 0) in a campaign inside the range, under the
 * resolved Excluded toggle.
 *
 * TWO CLOCKS (see `edgeIsLive`): the RANGE decides whether an edge exists, the
 * STATUS WINDOW decides whether it is live. So the scan is bounded BELOW by
 * the range start only — the in-range sums are FILTERed to `date <= to`, while
 * the pair's last spend day is read from the same rows unclipped, because
 * "live" means spending NOW. Liveness is then judged in JS against the cached
 * `platformSpendFreshness()`: no second scan.
 *
 * Query discipline (`lib/db.ts` is `max: 1`): ONE aggregation scan of
 * `performance_records` builds every edge and both node sets; statuses derive
 * from the request's cached status inputs (never another status scan); and the
 * "active but idle" creatives — live, but with no edge in this range, included
 * as unconnected nodes so the insight chip has something to focus — cost one
 * PK lookup on `creatives`, and only when there are any.
 *
 * Node totals are the entity's TRUE range spend under the SQL-level filters;
 * the status filter and the scale cap only HIDE things, they never restate a
 * number — so "42% of this campaign's spend" stays honest whatever is shown.
 *
 * THE LEVEL (2026-11): the scan is the same at both levels — one row per
 * (ad set, creative) — and `canvasPairs` FOLDS it to (campaign, creative)
 * before any total, health count or cap is taken, so every rule above holds
 * for a campaign exactly as for an ad set. Campaign level adds one registry
 * read (which ad sets a campaign has — its status and its count), never a
 * second scan of the records.
 */
export async function canvasGraph(f: CanvasFilters): Promise<CanvasGraph> {
  const acct = await getActiveAccountId();
  const level: CanvasLevel = f.level ?? "adset";

  const conds: SQL[] = [
    eq(performanceRecords.accountId, acct),
    // Bounded below only — see the two-clocks note above.
    gte(performanceRecords.date, f.from),
    ...creativeConds(f),
  ];
  // The RANGE clock: every in-range figure is this FILTER over the scan.
  const inRange = scopedMetrics(sql`${performanceRecords.date} <= ${f.to}`);
  if (!f.includeExcluded) {
    conds.push(eq(performanceRecords.excludedFromAggregates, false));
  }
  if (f.platforms && f.platforms.length > 0) {
    conds.push(inArray(performanceRecords.platform, f.platforms));
  }

  // LAUNCHED (C7): who had real spend BEFORE the range. Under the canvas's
  // platform filter and Excluded toggle — the facts the canvas draws — but NOT
  // its creative filters (product, stage): those pick creatives, and must not
  // make an old campaign read as launched.
  const before: SQL[] = [
    eq(performanceRecords.accountId, acct),
    sql`${performanceRecords.date} < ${f.from}`,
    gt(performanceRecords.spend, "0"),
  ];
  if (!f.includeExcluded) before.push(eq(performanceRecords.excludedFromAggregates, false));
  if (f.platforms && f.platforms.length > 0) {
    before.push(inArray(performanceRecords.platform, f.platforms));
  }

  const [rows, creativeStatuses, campaignStatuses, freshness, windowHours, ratingConfig, priorCreatives, priorCampaigns, registry] = await Promise.all([
    db
      .select({
        campaignId: campaigns.id,
        campaignName: campaigns.name,
        objective: campaigns.objective,
        campaignPlatform: campaigns.platform,
        // The ad set's CAMPAIGN — LEFT JOINed: `parent_id` is nullable until
        // the contract migration, and an ad set without one still draws.
        parentId: parentCampaigns.id,
        parentName: parentCampaigns.name,
        parentNetwork: parentCampaigns.network,
        creativeId: creatives.id,
        creativeName: creatives.name,
        type: creatives.type,
        priority: creatives.priority,
        stages: creatives.stages,
        thumbnailUrl: creatives.thumbnailUrl,
        spend: inRange.spend,
        conversions: inRange.conversions,
        revenue: inRange.conversionValue,
        // The WINDOW clock's input: the pair's last REAL-spend day, unclipped.
        lastSpendDay: sql<string | null>`MAX(${performanceRecords.date}) FILTER (WHERE ${performanceRecords.spend} > 0)`,
        // LAUNCHED's input: the pair's first real-spend day IN the range.
        firstSpendDay: sql<string | null>`MIN(${performanceRecords.date}) FILTER (WHERE ${performanceRecords.spend} > 0 AND ${performanceRecords.date} <= ${f.to})`,
      })
      .from(performanceRecords)
      .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
      .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
      .leftJoin(parentCampaigns, eq(parentCampaigns.id, campaigns.parentId))
      .where(and(...conds))
      .groupBy(campaigns.id, creatives.id, parentCampaigns.id)
      // An edge EXISTS only on in-range spend — later spend alone draws nothing.
      .having(gt(inRange.spend, 0)),
    creativeStatusMap(),
    campaignStatusMap(),
    platformSpendFreshness(),
    getActiveStatusWindowHours(),
    // The Rate lens's rules — cached per request, shared with the legend.
    getRatingConfig(),
    db
      .selectDistinct({ id: performanceRecords.creativeId })
      .from(performanceRecords)
      .where(and(...before)),
    // Who spent before, on the campaign side — at the level being drawn: a
    // campaign launched only if NONE of its ad sets had spent before.
    level === "campaign"
      ? db
          .selectDistinct({ id: campaigns.parentId })
          .from(performanceRecords)
          .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
          .where(and(...before))
      : db
          .selectDistinct({ id: performanceRecords.campaignId })
          .from(performanceRecords)
          .where(and(...before)),
    // Campaign level only: which ad sets each campaign HAS (the registry, not
    // the records) — its status is "any ad set active", and that ad set may
    // have no spend inside an old range.
    level === "campaign"
      ? db
          .select({ id: campaigns.id, parentId: campaigns.parentId })
          .from(campaigns)
          .where(eq(campaigns.accountId, acct))
      : Promise.resolve([] as Array<{ id: string; parentId: string | null }>),
  ]);
  const sideNodeId = level === "campaign" ? parentNodeId : campaignNodeId;
  const spentBefore = new Set<string>([
    ...priorCreatives.map((r) => creativeNodeId(r.id)),
    ...priorCampaigns.flatMap((r) => (r.id === null ? [] : [sideNodeId(r.id)])),
  ]);
  const windowDays = hoursToWindowDays(windowHours);
  const adSetsOf = new Map<string, string[]>();
  for (const r of registry) {
    if (r.parentId === null) continue;
    const list = adSetsOf.get(r.parentId) ?? [];
    list.push(r.id);
    adSetsOf.set(r.parentId, list);
  }

  const shown = new Set<CreativeStatus>(f.statuses);
  const statusOf = (creativeId: string) =>
    scopedStatus(statusFor(creativeStatuses, creativeId), f.platforms);

  // Totals FIRST, over every scanned edge — hiding a creative below must not
  // restate its campaign's spend.
  const campaignNodes = new Map<string, CanvasCampaignNode>();
  const creativeNodes = new Map<string, CanvasCreativeNode>();
  const allEdges: CanvasEdge[] = [];
  // The scan as PAIRINGS at the level drawn (`canvasPairs`) — ad sets: one per
  // row; campaigns: a campaign's ad sets folded per creative, summed.
  const scan: CanvasScanRow[] = rows.map((r) => ({
    campaignId: r.campaignId,
    campaignName: r.campaignName,
    objective: r.objective,
    campaignPlatform: r.campaignPlatform,
    parentId: r.parentId,
    parentName: r.parentName,
    parentNetwork: r.parentNetwork,
    creativeId: r.creativeId,
    spend: Number(r.spend ?? 0),
    conversions: Number(r.conversions ?? 0),
    revenue: Number(r.revenue ?? 0),
    lastSpendDay: r.lastSpendDay,
    firstSpendDay: r.firstSpendDay,
  }));
  const creativeFacts = new Map(rows.map((r) => [r.creativeId, r]));
  /** A campaign-side node's spend per platform — picks the one it is marked by. */
  const platformSpend = new Map<string, Map<string, number>>();
  const objectivesOf = new Map<string, string[]>();
  const verdictCtx = { freshness, windowDays, ratingConfig };

  for (const pair of canvasPairs(scan, level)) {
    const { spend, conversions, revenue, firstSpendDay: first } = pair;
    const cid = pair.sideId;
    const camp = campaignNodes.get(cid);
    if (camp) {
      camp.spend += spend;
      camp.conversions += conversions;
      camp.revenue += revenue;
      camp.launchedOn = earlierDay(camp.launchedOn, first);
    } else {
      // A CAMPAIGN is active when ANY of its registered ad sets is — the
      // ad-set rule rolled up, from the one cached status map.
      const adSetIds = level === "campaign" ? (adSetsOf.get(pair.rowId) ?? pair.adSetIds) : pair.adSetIds;
      campaignNodes.set(cid, {
        kind: "campaign",
        level,
        id: cid,
        campaignId: pair.rowId,
        name: pair.name,
        objective: "", // filled below, once every pairing has been seen
        platform: pair.byPlatform[0]?.platform ?? "",
        platforms: [],
        network: pair.network,
        parentId: pair.parentId,
        adSets: adSetIds.length,
        status: adSetIds.some((id) => campaignStatusFor(campaignStatuses, id) === "active")
          ? "active"
          : "inactive",
        spend,
        conversions,
        revenue,
        liveChildren: 0, // filled from edge liveness below
        totalChildren: 0,
        launchedOn: first, // the min over its pairs; cleared below if it spent before
      });
    }
    const perPlatform = platformSpend.get(cid) ?? new Map<string, number>();
    for (const p of pair.byPlatform) {
      perPlatform.set(p.platform, (perPlatform.get(p.platform) ?? 0) + p.spend);
    }
    platformSpend.set(cid, perPlatform);
    const objectives = objectivesOf.get(cid) ?? [];
    for (const o of pair.objectives) if (!objectives.includes(o)) objectives.push(o);
    objectivesOf.set(cid, objectives);

    const kid = creativeNodeId(pair.creativeId);
    const cre = creativeNodes.get(kid);
    if (cre) {
      cre.spend += spend;
      cre.conversions += conversions;
      cre.revenue += revenue;
      cre.launchedOn = earlierDay(cre.launchedOn, first);
    } else {
      const fact = creativeFacts.get(pair.creativeId)!;
      creativeNodes.set(kid, {
        kind: "creative",
        id: kid,
        creativeId: pair.creativeId,
        name: fact.creativeName,
        type: fact.type as CanvasCreativeType,
        status: statusOf(pair.creativeId),
        priority: fact.priority,
        stages: sortStages(fact.stages ?? []),
        thumbnailUrl: fact.thumbnailUrl,
        spend,
        conversions,
        revenue,
        launchedOn: first,
        angles: [], // filled below, for the creatives drawn
        roas: null, // the creative's own Rate, after its totals are summed
        rate: "na",
      });
    }

    allEdges.push({
      id: `${cid}|${kid}`,
      source: cid,
      target: kid,
      spend,
      // Both clocks' verdicts and the Rate, from the pairing's per-platform
      // slices — one platform for an ad set, up to two for a Meta campaign.
      ...pairVerdict(pair, verdictCtx),
    });
  }

  // What each campaign-side node is MARKED by: the platform that spent most
  // there in the range, and the objectives its ad sets carry.
  for (const node of campaignNodes.values()) {
    const ranked = [...(platformSpend.get(node.id) ?? new Map<string, number>()).entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    node.platforms = ranked.map(([p]) => p);
    node.platform = node.platforms[0] ?? node.platform;
    node.objective = (objectivesOf.get(node.id) ?? []).join(" · ");
  }

  // The CREATIVE's own Rate (By angle's chip colour), over its summed totals.
  for (const n of creativeNodes.values()) {
    Object.assign(n, creativeRate(n, f.platforms, ratingConfig));
  }

  // A first in-range day is a LAUNCH only if nothing spent before the range.
  for (const n of [...campaignNodes.values(), ...creativeNodes.values()]) {
    if (spentBefore.has(n.id)) n.launchedOn = null;
  }

  // HEALTH, over every scanned edge — a fact about the campaign, like its
  // totals, so the status filter and the scale cap below can't restate it.
  for (const [id, h] of campaignHealth(allEdges)) {
    const node = campaignNodes.get(id);
    if (node) {
      node.liveChildren = h.live;
      node.totalChildren = h.total;
    }
  }

  // The status filter HIDES creatives (and the edges into them).
  const visibleEdges = allEdges.filter((e) =>
    shown.has(creativeNodes.get(e.target)!.status),
  );

  // Scale cap: the top connections by spend, and the page says so.
  const { kept, total, truncated } = capEdges(visibleEdges);
  const keptNodeIds = new Set<string>();
  for (const e of kept) {
    keptNodeIds.add(e.source);
    keptNodeIds.add(e.target);
  }

  // Active-but-idle creatives: live by status, no edge in this range.
  let idle: CanvasCreativeNode[] = [];
  if (shown.has("active")) {
    const idleIds: string[] = [];
    for (const id of creativeStatuses.keys()) {
      if (creativeNodes.has(creativeNodeId(id))) continue; // it spent here
      if (statusOf(id) === "active") idleIds.push(id);
    }
    if (idleIds.length > 0) {
      const idleRows = await db
        .select({
          id: creatives.id,
          name: creatives.name,
          type: creatives.type,
          priority: creatives.priority,
          stages: creatives.stages,
          thumbnailUrl: creatives.thumbnailUrl,
        })
        .from(creatives)
        .where(
          and(
            eq(creatives.accountId, acct),
            inArray(creatives.id, idleIds),
            ...creativeConds(f),
          ),
        );
      idle = idleRows
        .map((r): CanvasCreativeNode => ({
          kind: "creative",
          id: creativeNodeId(r.id),
          creativeId: r.id,
          name: r.name,
          type: r.type as CanvasCreativeType,
          status: "active",
          priority: r.priority,
          stages: sortStages(r.stages ?? []),
          thumbnailUrl: r.thumbnailUrl,
          spend: 0,
          conversions: 0,
          revenue: 0,
          launchedOn: null, // no spend in the range — nothing launched
          angles: [],
          roas: null,
          rate: "na" as const,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
  }
  // Idle nodes share the node budget; what doesn't fit is COUNTED, not dropped
  // silently.
  const idleRoom = Math.max(0, CANVAS_MAX_NODES - keptNodeIds.size);
  const idleShown = idle.slice(0, idleRoom);
  const idleHidden = idle.length - idleShown.length;

  const drawnCreatives = [
    ...[...creativeNodes.values()].filter((n) => keptNodeIds.has(n.id)),
    ...idleShown,
  ];
  // ANGLES (C8), for the creatives drawn only. `creative_angles` has no
  // account_id: the ids come from this brand's own scan, which bounds it.
  if (drawnCreatives.length > 0) {
    const angleRows = await db
      .select({ creativeId: creativeAngles.creativeId, angle: creativeAngles.angle })
      .from(creativeAngles)
      .where(inArray(creativeAngles.creativeId, drawnCreatives.map((c) => c.creativeId)));
    const anglesOf = new Map<string, string[]>();
    for (const r of angleRows) {
      const list = anglesOf.get(r.creativeId) ?? [];
      list.push(r.angle);
      anglesOf.set(r.creativeId, list);
    }
    for (const c of drawnCreatives) {
      c.angles = (anglesOf.get(c.creativeId) ?? []).sort((a, b) => a.localeCompare(b));
    }
  }

  return {
    level,
    campaigns: [...campaignNodes.values()].filter((n) => keptNodeIds.has(n.id)),
    creatives: drawnCreatives,
    edges: kept,
    truncated:
      truncated || idleHidden > 0
        ? { shownEdges: kept.length, totalEdges: total, idleHidden }
        : null,
  };
}

/**
 * The NAME behind a `?focus=` link whose node isn't drawn (it didn't spend in
 * the range, the filters hide it, or the scale cap trimmed it) — so the page
 * can say WHICH creative or campaign the link was about. Brand-scoped: an id
 * from another brand reads as unknown (null), never as its name.
 */
export async function canvasFocusName(
  focus: Pick<CanvasFocusParam, "kind" | "id">,
): Promise<string | null> {
  const acct = await getActiveAccountId();
  const rows =
    focus.kind === "campaign"
      ? await db
          .select({ name: campaigns.name })
          .from(campaigns)
          .where(and(eq(campaigns.id, focus.id), eq(campaigns.accountId, acct)))
          .limit(1)
      : focus.kind === "parent_campaign"
        ? await db
            .select({ name: parentCampaigns.name })
            .from(parentCampaigns)
            .where(and(eq(parentCampaigns.id, focus.id), eq(parentCampaigns.accountId, acct)))
            .limit(1)
        : await db
          .select({ name: creatives.name })
          .from(creatives)
          .where(and(eq(creatives.id, focus.id), eq(creatives.accountId, acct)))
          .limit(1);
  return rows[0]?.name ?? null;
}
