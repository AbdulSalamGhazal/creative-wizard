import { and, eq, gt, gte, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaigns,
  creativeAngles,
  creatives,
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
  pairRate,
  CANVAS_MAX_NODES,
  campaignHealth,
  campaignNodeId,
  capEdges,
  creativeNodeId,
  edgeIsLive,
  type CanvasCampaignNode,
  type CanvasCreativeNode,
  type CanvasCreativeType,
  type CanvasEdge,
  type CanvasFocusParam,
  type CanvasGraph,
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
 */
export async function canvasGraph(f: CanvasFilters): Promise<CanvasGraph> {
  const acct = await getActiveAccountId();

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

  const [rows, creativeStatuses, campaignStatuses, freshness, windowHours, ratingConfig, priorCreatives, priorCampaigns] = await Promise.all([
    db
      .select({
        campaignId: campaigns.id,
        campaignName: campaigns.name,
        objective: campaigns.objective,
        campaignPlatform: campaigns.platform,
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
      .where(and(...conds))
      .groupBy(campaigns.id, creatives.id)
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
    db
      .selectDistinct({ id: performanceRecords.campaignId })
      .from(performanceRecords)
      .where(and(...before)),
  ]);
  const spentBefore = new Set<string>([
    ...priorCreatives.map((r) => creativeNodeId(r.id)),
    ...priorCampaigns.map((r) => campaignNodeId(r.id)),
  ]);
  const windowDays = hoursToWindowDays(windowHours);

  const shown = new Set<CreativeStatus>(f.statuses);
  const statusOf = (creativeId: string) =>
    scopedStatus(statusFor(creativeStatuses, creativeId), f.platforms);

  // Totals FIRST, over every scanned edge — hiding a creative below must not
  // restate its campaign's spend.
  const campaignNodes = new Map<string, CanvasCampaignNode>();
  const creativeNodes = new Map<string, CanvasCreativeNode>();
  const allEdges: CanvasEdge[] = [];
  for (const r of rows) {
    const spend = Number(r.spend ?? 0);
    const conversions = Number(r.conversions ?? 0);
    const revenue = Number(r.revenue ?? 0);

    const first = r.firstSpendDay;
    const cid = campaignNodeId(r.campaignId);
    const camp = campaignNodes.get(cid);
    if (camp) {
      camp.spend += spend;
      camp.conversions += conversions;
      camp.revenue += revenue;
      camp.launchedOn = earlierDay(camp.launchedOn, first);
    } else {
      campaignNodes.set(cid, {
        kind: "campaign",
        id: cid,
        campaignId: r.campaignId,
        name: r.campaignName,
        objective: r.objective,
        platform: r.campaignPlatform,
        status: campaignStatusFor(campaignStatuses, r.campaignId),
        spend,
        conversions,
        revenue,
        liveChildren: 0, // filled from edge liveness below
        totalChildren: 0,
        launchedOn: first, // the min over its pairs; cleared below if it spent before
      });
    }

    const kid = creativeNodeId(r.creativeId);
    const cre = creativeNodes.get(kid);
    if (cre) {
      cre.spend += spend;
      cre.conversions += conversions;
      cre.revenue += revenue;
      cre.launchedOn = earlierDay(cre.launchedOn, first);
    } else {
      creativeNodes.set(kid, {
        kind: "creative",
        id: kid,
        creativeId: r.creativeId,
        name: r.creativeName,
        type: r.type as CanvasCreativeType,
        status: statusOf(r.creativeId),
        priority: r.priority,
        stages: sortStages(r.stages ?? []),
        thumbnailUrl: r.thumbnailUrl,
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
      platform: r.campaignPlatform,
      spend,
      ...pairRate({ spend, revenue, platform: r.campaignPlatform }, ratingConfig),
      lastSpendDay: r.lastSpendDay,
      live: edgeIsLive({
        lastSpendDay: r.lastSpendDay,
        platformLatestDay:
          freshness[r.campaignPlatform as keyof typeof freshness] ?? null,
        windowDays,
      }),
    });
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
      : await db
          .select({ name: creatives.name })
          .from(creatives)
          .where(and(eq(creatives.id, focus.id), eq(creatives.accountId, acct)))
          .limit(1);
  return rows[0]?.name ?? null;
}
