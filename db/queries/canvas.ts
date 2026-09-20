import { and, between, eq, gt, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaigns,
  creatives,
  performanceRecords,
  type platformEnum,
} from "@/db/schema";
import { sumConversionValue, sumConversions, sumSpend } from "@/lib/metrics";
import { getActiveAccountId } from "@/lib/tenant";
import { creativeStatusMap, statusFor } from "@/db/queries/creative-status";
import {
  campaignStatusFor,
  campaignStatusMap,
} from "@/db/queries/campaign-status";
import type { CreativeStatus, CreativeStatusResult } from "@/lib/creative-status";
import { sortStages, splitStageFilter } from "@/lib/funnel-stages";
import {
  CANVAS_MAX_NODES,
  campaignNodeId,
  capEdges,
  creativeNodeId,
  type CanvasCampaignNode,
  type CanvasCreativeNode,
  type CanvasCreativeType,
  type CanvasEdge,
  type CanvasGraph,
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
    between(performanceRecords.date, f.from, f.to),
    ...creativeConds(f),
  ];
  if (!f.includeExcluded) {
    conds.push(eq(performanceRecords.excludedFromAggregates, false));
  }
  if (f.platforms && f.platforms.length > 0) {
    conds.push(inArray(performanceRecords.platform, f.platforms));
  }

  const [rows, creativeStatuses, campaignStatuses] = await Promise.all([
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
        spend: sumSpend,
        conversions: sumConversions,
        revenue: sumConversionValue,
      })
      .from(performanceRecords)
      .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
      .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
      .where(and(...conds))
      .groupBy(campaigns.id, creatives.id)
      .having(gt(sumSpend, 0)),
    creativeStatusMap(),
    campaignStatusMap(),
  ]);

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

    const cid = campaignNodeId(r.campaignId);
    const camp = campaignNodes.get(cid);
    if (camp) {
      camp.spend += spend;
      camp.conversions += conversions;
      camp.revenue += revenue;
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
      });
    }

    const kid = creativeNodeId(r.creativeId);
    const cre = creativeNodes.get(kid);
    if (cre) {
      cre.spend += spend;
      cre.conversions += conversions;
      cre.revenue += revenue;
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
      });
    }

    allEdges.push({
      id: `${cid}|${kid}`,
      source: cid,
      target: kid,
      platform: r.campaignPlatform,
      spend,
    });
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
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
  }
  // Idle nodes share the node budget; what doesn't fit is COUNTED, not dropped
  // silently.
  const idleRoom = Math.max(0, CANVAS_MAX_NODES - keptNodeIds.size);
  const idleShown = idle.slice(0, idleRoom);
  const idleHidden = idle.length - idleShown.length;

  return {
    campaigns: [...campaignNodes.values()].filter((n) => keptNodeIds.has(n.id)),
    creatives: [
      ...[...creativeNodes.values()].filter((n) => keptNodeIds.has(n.id)),
      ...idleShown,
    ],
    edges: kept,
    truncated:
      truncated || idleHidden > 0
        ? { shownEdges: kept.length, totalEdges: total, idleHidden }
        : null,
  };
}
