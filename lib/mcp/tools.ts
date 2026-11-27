import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { platformEnum, creativeTypeEnum } from "@/db/schema";
import { CREATIVE_STAGE_OPTIONS, NA_STAGE } from "@/lib/funnel-stages";
import { CREATIVE_STATUSES } from "@/lib/creative-status";
import { defaultDateRange, shiftIso, todayIso } from "@/lib/date-presets";
import { allowedAccountsForUser } from "@/lib/tenant";
import {
  kpis,
  platformMix,
  campaignMix,
  metricOverTime,
  type KpiFilters,
  type BreakdownDimension,
} from "@/db/queries/performance";
import {
  listCreatives,
  getCreativeByName,
  type CreativeListFilters,
} from "@/db/queries/creatives";
import {
  portfolioCampaigns,
  portfolioParentCampaigns,
  type PortfolioFilters,
} from "@/db/queries/portfolio";
import {
  campaignMeta,
  campaignAnalytics,
  campaignDailyByCreative,
} from "@/db/queries/campaign";
import { AD_NETWORKS, parseCampaignName } from "@/lib/campaign";
import {
  parentCampaignAdSets,
  parentCampaignDailyByAdSet,
  parentCampaignMeta,
} from "@/db/queries/parent-campaign";
import { creativeStatusMap, statusFor } from "@/db/queries/creative-status";
import { campaignStatusMap, campaignStatusFor } from "@/db/queries/campaign-status";
import { listCreativeSummary } from "@/db/queries/summary";
import { getRatingConfig } from "@/db/queries/rating";
import { funnelOverview } from "@/db/queries/funnel";
import { platformHorizons, dataHorizon } from "@/db/queries/series-bounds";
import { campaignDiagnosisInput } from "@/db/queries/diagnosis";
import {
  budgetPacingSeries,
  budgetPlansForMonths,
  getUsdToSarRate,
  listPlanRevisionLog,
  planRevisionStats,
} from "@/db/queries/budget";
import { buildMonthReview } from "@/lib/budget-review";
import { buildRangeModel } from "@/lib/budget-range";
import { buildAttention } from "@/lib/budget-attention";
import { storeDataHorizon } from "@/db/queries/series-bounds";
import { storeTopProducts } from "@/db/queries/store";
import {
  storeInsightsBreakdown,
  storeInsightsDaily,
  storeInsightsKpis,
  storeInsightsProducts,
  storeInsightsSections,
} from "@/db/queries/store-insights";
import { storeConnectionStatus } from "@/db/queries/store-connector";
import { reconciliationByPlatform, reconciliationOverview } from "@/db/queries/reconciliation";
import { landingPageRollup } from "@/db/queries/landing-page-performance";
import { getLandingPageByCode, landingPageCreatives } from "@/db/queries/landing-pages";
import { angleRollup, typeRollup } from "@/db/queries/trends";
import { canvasGraph } from "@/db/queries/canvas";
import {
  canvasInsights,
  inspectFor,
  type CanvasInsight,
  type InspectorPairing,
} from "@/lib/canvas";
import { CANVAS_DEFAULT_STATUSES } from "@/validators/canvas";
import { listAllProductOptions, listProducts } from "@/db/queries/products";
import {
  daysInMonth,
  elapsedDaysInMonth,
  pacingDeviation,
  latestCoverage,
  monthEndIso,
  monthKey,
  prevMonthKey,
  monthStartIso,
  pacingVerdict,
  type TrackerBar,
} from "@/lib/budget";
import { resolveBudgetMonth } from "@/validators/budget";
import {
  CHANNEL_LENS,
  PLATFORM_LENS,
  avgDeliveryDays,
  grossProfit,
  type SectionLens,
} from "@/lib/store-insights";
import { reconDelta, reconDeltaPct, reconMatchRate, sumPlatformDays } from "@/lib/reconciliation";
import { STORE_SOURCE_FIELD_KEY } from "@/store/fields";
import { UNATTRIBUTED } from "@/store/sources";
import { serializeDiagnosis } from "@/lib/diagnosis";
import { priceStructureAccess, VIEW_PERM as PS_VIEW_PERM } from "@/lib/price-structure-access";
import { getLastVersionId, listVersions } from "@/db/queries/price-structure";
import { actualFacts, actualMappings, RATE_WINDOW_DAYS } from "@/db/queries/price-structure-actual";
import { computeActual } from "@/price-structure/actual/engine";
import { actualCmlPayload } from "@/lib/mcp/price-structure-actual";
import {
  currentActor,
  withBrand,
  ok,
  excludedEcho,
  capRows,
  McpToolError,
  type RangeEcho,
} from "@/lib/mcp/runtime";

/**
 * The read-only MCP tool set. Every tool reuses a `db/queries/*` function (never
 * raw SQL), takes a Zod input schema, and returns compact JSON with a
 * `{ brand, range }` echo. Tool descriptions state the conventions the LLM needs:
 * money is USD, dates are YYYY-MM-DD, and blended metrics (CTR/ROAS/CPA/…) are
 * weighted from component sums — never a mean of per-row ratios.
 *
 * v1 is STRICTLY READ-ONLY. To add a tool, follow this pattern (Zod schema +
 * `withBrand` + a query reuse); never introduce a mutating tool here.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const CONVENTIONS =
  "Money is USD. Dates are YYYY-MM-DD. Blended metrics (CTR, ROAS, CPA, CvR, VOC, CPM) are weighted from component sums, never averaged. Records marked excluded-from-aggregates are HIDDEN by default (the app's default view); pass include_excluded: true to count them. Every result echoes `excluded_records` so you never have to guess which convention produced a number. Google reports a REDUCED metric set (no landing-page views, cart/payment events or video views), so it is left out of per-platform creative breakdowns and of every funnel surface; brand- and campaign-level tools include it.";

/**
 * TWO LEVELS (2026-11). The app now has a CAMPAIGN above the AD SET, and the
 * object these tools have always called a "campaign" is the ad set. The tool
 * NAMES and their default grain are unchanged (callers and saved prompts rely
 * on them), so every campaign-shaped description says which level it means.
 */
const TWO_LEVELS =
  'A CAMPAIGN holds AD SETS; an ad set is stored under the name "Campaign ➤ Ad set" (plus " (IG)" / " (FB)" on Instagram / Facebook), and what the app called a "campaign" before 2026-11 is an ad set.';

/** The two parts of an ad set's stored name, for a row that carries only it. */
function adSetParts(
  storedName: string,
  platform: string | undefined,
): { parent_campaign: string; ad_set: string } {
  const { campaign, adset } = parseCampaignName(storedName, platform ?? "");
  return { parent_campaign: campaign, ad_set: adset };
}

/**
 * BREAKING CHANGE (2026-09): the creative-labeling concept "tag" was renamed
 * "angle" everywhere, so the `tags` field and `tags` filter are now `angles`.
 * There is no back-compat alias — a caller still sending `tags` gets a schema
 * error rather than a silently ignored filter. Appended to the description of
 * every tool whose shape changed so an already-connected client sees it.
 */
const ANGLES_RENAME =
  "BREAKING (2026-09): the former `tags` field/filter is now `angles` — `tags` is no longer accepted.";

// Shared input fields (Zod raw-shape fragments).
const brandField = z
  .string()
  .optional()
  .describe(
    "Brand name or id to scope this call to. Optional when you have exactly one brand; required (with the allowed list) otherwise.",
  );
const fromField = z
  .string()
  .regex(ISO)
  .optional()
  .describe("Start date, inclusive (YYYY-MM-DD). Omit for all-time.");
const toField = z
  .string()
  .regex(ISO)
  .optional()
  .describe("End date, inclusive (YYYY-MM-DD). Omit for all-time.");
const platformsField = z
  .array(z.enum(platformEnum))
  .optional()
  .describe(`Restrict to these platforms (${platformEnum.join(", ")}).`);
const typesField = z
  .array(z.enum(creativeTypeEnum))
  .optional()
  .describe("Restrict to these creative types (video, image, slides).");
const productIdsField = z
  .array(z.string())
  .optional()
  .describe("Restrict to these product ids.");
const anglesField = z.array(z.string()).optional().describe("Restrict to these angles.");
/**
 * The creative's MANUAL funnel stage(s) — the team's declaration, never derived
 * from the campaign objective it runs under or from where it spends.
 */
const stagesField = z
  .array(z.enum(CREATIVE_STAGE_OPTIONS))
  .optional()
  .describe(
    "Restrict to creatives carrying ANY of these manual funnel stages (Awareness, Activation, Retargeting). " +
      `"${NA_STAGE}" is the explicit "no clear stage" declaration — different from a creative with no stages declared at all.`,
  );
/**
 * The exclusion lever, on every tool whose numbers come from performance
 * aggregates. It threads into the SAME `includeExcluded` flag the pages use —
 * the `excluded_from_aggregates = false` WHERE convention is never bypassed by
 * hand here any more than it is there.
 */
const includeExcludedField = z
  .boolean()
  .optional()
  .default(false)
  .describe(
    "Include records marked excluded-from-aggregates. Default false, matching the app's default view.",
  );

function rangeEcho(from?: string, to?: string): RangeEcho {
  return { from: from ?? null, to: to ?? null };
}

/** Round money/ratio numbers so payloads stay compact; passes null through. */
function r2(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return Math.round(v * 100) / 100;
}

export function registerMcpTools(server: McpServer): void {
  // 1 ─ list_brands ----------------------------------------------------------
  server.registerTool(
    "list_brands",
    {
      description:
        "List the brands (accounts) you can access, with their ids. Use a brand's name or id as the `brand` argument of the other tools. If you have exactly one brand, the other tools default to it.",
      inputSchema: {},
    },
    async () => {
      const { user } = currentActor();
      const brands = await allowedAccountsForUser(user);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              brands: brands.map((b) => ({ id: b.id, name: b.name })),
            }),
          },
        ],
      };
    },
  );

  // 2 ─ get_kpis -------------------------------------------------------------
  server.registerTool(
    "get_kpis",
    {
      description: `Headline KPIs for a date range — spend, conversions, revenue, CPA, ROAS, CTR, CvR, CPM — plus a per-platform split. Mirrors the dashboard tiles. ${CONVENTIONS} ${ANGLES_RENAME}`,
      inputSchema: {
        brand: brandField,
        from: fromField,
        to: toField,
        platforms: platformsField,
        productIds: productIdsField,
        types: typesField,
        angles: anglesField,
        include_excluded: includeExcludedField,
      },
    },
    async (args) =>
      withBrand(args.brand, async (brand) => {
        const filters: KpiFilters = {
          from: args.from,
          to: args.to,
          platforms: args.platforms,
          productIds: args.productIds,
          types: args.types,
          angles: args.angles,
          includeExcluded: args.include_excluded,
        };
        const [k, mix] = await Promise.all([kpis(filters), platformMix(filters)]);
        return ok(brand, rangeEcho(args.from, args.to), {
          totals: {
            spend: r2(k.spend),
            impressions: k.impressions,
            clicks: k.clicks,
            conversions: k.conversions,
            revenue: r2(k.conversionValue),
            ctr: k.ctr,
            cpm: r2(k.cpm),
            cpc: r2(k.cpc),
            cpa: r2(k.cpa),
            roas: r2(k.roas),
            cvr: k.cvr,
            voc: k.voc,
          },
          byPlatform: mix.map((m) => ({
            platform: m.platform,
            spend: r2(m.spend),
            conversions: m.conversions,
            revenue: r2(m.conversionValue),
            cpa: r2(m.cpa),
            roas: r2(m.roas),
            ctr: m.ctr,
          })),
        }, excludedEcho(args.include_excluded));
      }),
  );

  // 3 ─ list_creatives -------------------------------------------------------
  server.registerTool(
    "list_creatives",
    {
      description: `List creatives (the Library) with derived status, priority (1-3, null = unrated), manual funnel stage(s), angles, and 7d/30d spend. Filterable by status, type, product, angles, stage, and search. Capped at 500 rows (\`truncated\` flag). ${CONVENTIONS} ${ANGLES_RENAME}`,
      inputSchema: {
        brand: brandField,
        status: z
          .array(z.enum(CREATIVE_STATUSES))
          .optional()
          .describe("Restrict to these derived statuses."),
        types: typesField,
        productIds: productIdsField,
        angles: anglesField,
        stages: stagesField,
        q: z.string().optional().describe("Search name/notes/angles (substring)."),
        platforms: platformsField,
        include_excluded: includeExcludedField,
      },
    },
    async (args) =>
      withBrand(args.brand, async (brand) => {
        const filters: CreativeListFilters = {
          statuses: args.status,
          types: args.types,
          productIds: args.productIds,
          angles: args.angles,
          stages: args.stages,
          q: args.q,
          platforms: args.platforms,
          sort: "spend-desc",
          // Drives the 7d/30d spend windows on every row.
          includeExcluded: args.include_excluded,
        };
        const result = await listCreatives(filters);
        const { rows, truncated } = capRows(result.rows);
        return ok(brand, null, {
          totalMatching: result.totalMatching,
          truncated,
          creatives: rows.map((c) => ({
            id: c.id,
            name: c.name,
            product: c.productName,
            type: c.type,
            status: c.status,
            priority: c.priority,
            stages: c.stages,
            angles: c.angles,
            spend7d: r2(c.spend7d),
            spend30d: r2(c.spend30d),
            launchDate: c.launchDate,
          })),
        }, excludedEcho(args.include_excluded));
      }),
  );

  // 4 ─ get_creative ---------------------------------------------------------
  server.registerTool(
    "get_creative",
    {
      description: `One creative in depth: fields, manual funnel stage(s), angles, per-platform status, and its performance breakdown per AD SET it ran in (all-time unless a range is given). ${TWO_LEVELS} So each \`byCampaign\` row is ONE AD SET: \`campaign\` is its full stored name, \`ad_set\` its own name, \`parent_campaign\` + \`network\` the CAMPAIGN it sits under (sum the rows sharing those two for a campaign's figure — sums, never an average of ratios), with the ad set's objective. ${CONVENTIONS} ${ANGLES_RENAME}`,
      inputSchema: {
        brand: brandField,
        name: z.string().describe("Exact creative name."),
        from: fromField,
        to: toField,
        include_excluded: includeExcludedField,
      },
    },
    async (args) =>
      withBrand(args.brand, async (brand) => {
        const creative = await getCreativeByName(args.name);
        if (!creative) throw new McpToolError(`No creative named "${args.name}".`);
        const [mix, statusMap] = await Promise.all([
          campaignMix({
            creativeIds: [creative.id],
            from: args.from,
            to: args.to,
            includeExcluded: args.include_excluded,
          }),
          creativeStatusMap([creative.id]),
        ]);
        const status = statusFor(statusMap, creative.id);
        return ok(brand, rangeEcho(args.from, args.to), {
          creative: {
            id: creative.id,
            name: creative.name,
            product: creative.productName,
            type: creative.type,
            priority: creative.priority,
            stages: creative.stages,
            angles: creative.angles,
            launchDate: creative.launchDate,
            sourceLink: creative.sourceLink,
            status: status.general,
            statusPerPlatform: status.perPlatform,
          },
          byCampaign: mix.map((m) => ({
            campaign: m.campaign,
            ad_set: adSetParts(m.campaign, m.platform).ad_set,
            parent_campaign: m.parentCampaign,
            network: m.network,
            objective: m.objective,
            platform: m.platform,
            spend: r2(m.spend),
            conversions: m.conversions,
            revenue: r2(m.conversionValue),
            cpa: r2(m.cpa),
            roas: r2(m.roas),
            ctr: m.ctr,
          })),
        }, excludedEcho(args.include_excluded));
      }),
  );

  // 5 ─ list_campaigns -------------------------------------------------------
  server.registerTool(
    "list_campaigns",
    {
      description: `The campaign portfolio. ${TWO_LEVELS} Default \`level: "ad_set"\`: one row per AD SET — status (active/inactive), objective, platform(s), and KPIs (spend, orders, revenue, ROAS, CPA, CTR) for a range (defaults to last 30 days); \`campaign\` is its full stored name, \`parent_campaign\` + \`ad_set\` the two parts. \`level: "campaign"\`: one row per CAMPAIGN, its ad sets rolled up (weighted from the summed records, never averaged) — \`ad_sets\` count, every \`objective\` its ad sets carry, active when any ad set is; a campaign that has never run is listed with \`has_data: false\`. Capped at 500 rows. ${CONVENTIONS}`,
      inputSchema: {
        brand: brandField,
        from: fromField,
        to: toField,
        platforms: platformsField,
        level: z
          .enum(["ad_set", "campaign"])
          .default("ad_set")
          .describe(
            'Row grain: "ad_set" (default — one row per ad set) or "campaign" (one row per campaign, its ad sets rolled up).',
          ),
        include_excluded: includeExcludedField,
      },
    },
    async (args) =>
      withBrand(args.brand, async (brand) => {
        const range = defaultRange(args.from, args.to);
        const filters: PortfolioFilters = {
          from: range.from,
          to: range.to,
          platforms: args.platforms,
          includeExcluded: args.include_excluded,
        };
        if (args.level === "campaign") {
          const allParents = await portfolioParentCampaigns(filters);
          const { rows, truncated } = capRows(allParents);
          return ok(brand, rangeEcho(range.from, range.to), {
            level: "campaign",
            count: allParents.length,
            truncated,
            campaigns: rows.map((c) => ({
              id: c.campaignId,
              campaign: c.campaign,
              network: c.network,
              ad_sets: c.adSets,
              status: c.status,
              objectives: c.objectives,
              platforms: c.platforms,
              has_data: c.hasData,
              creatives: c.hasData ? c.creatives : null,
              spend: c.hasData ? r2(c.spend) : null,
              orders: c.hasData ? c.orders : null,
              revenue: c.hasData ? r2(c.revenue) : null,
              roas: r2(c.roas),
              cpa: r2(c.cpa),
              ctr: c.ctr,
              lastDate: c.lastDate,
            })),
          }, excludedEcho(args.include_excluded));
        }
        const all = await portfolioCampaigns(filters);
        const { rows, truncated } = capRows(all);
        return ok(brand, rangeEcho(range.from, range.to), {
          level: "ad_set",
          count: all.length,
          truncated,
          campaigns: rows.map((c) => ({
            id: c.campaignId,
            campaign: c.campaign,
            // The CAMPAIGN it sits under (the registry's own row, with its
            // network) and the ad set's own name (platform tag dropped).
            parent_campaign: c.parentCampaign,
            network: c.network,
            ad_set: adSetParts(c.campaign, c.platforms[0]).ad_set,
            status: c.status,
            objective: c.objective,
            platforms: c.platforms,
            creatives: c.creatives,
            spend: r2(c.spend),
            orders: c.orders,
            revenue: r2(c.revenue),
            roas: r2(c.roas),
            cpa: r2(c.cpa),
            ctr: c.ctr,
            lastDate: c.lastDate,
          })),
        }, excludedEcho(args.include_excluded));
      }),
  );

  // 6 ─ get_campaign ---------------------------------------------------------
  server.registerTool(
    "get_campaign",
    {
      description: `One AD SET (a row of list_campaigns at its default level — ${TWO_LEVELS}): totals + KPIs for a range, its liveness status, the campaign it sits under, and the gap-filled daily per-creative series (the exact points its chart draws). \`level: "campaign"\`: one CAMPAIGN instead — \`name\` is the campaign's own name (the \`campaign\` field of list_campaigns at level "campaign"); totals + KPIs over every record of every ad set under it (weighted from the summed records, never an average of its ad sets), its status (active when any ad set is), every registered ad set side by side (\`has_data: false\` for one with nothing in the range), and the gap-filled daily series per ad set. A name is unique per ad network, so pass \`network\` when two networks share it. ${CONVENTIONS}`,
      inputSchema: {
        brand: brandField,
        name: z
          .string()
          .describe(
            'Level "ad_set" (default): the exact stored name of the ad set — the `campaign` field of list_campaigns, e.g. "Holiday ➤ Broad (IG)". Level "campaign": the campaign\'s own name, e.g. "Holiday".',
          ),
        level: z
          .enum(["ad_set", "campaign"])
          .default("ad_set")
          .describe('"ad_set" (default — one ad set) or "campaign" (one campaign, its ad sets rolled up).'),
        network: z
          .enum(AD_NETWORKS)
          .optional()
          .describe(
            `Level "campaign" only: the campaign's ad network (${AD_NETWORKS.join(", ")}; meta = Instagram + Facebook). Needed only when the same name exists on two networks.`,
          ),
        from: fromField,
        to: toField,
        include_excluded: includeExcludedField,
      },
    },
    async (args) =>
      withBrand(args.brand, async (brand) => {
        if (args.level === "campaign") {
          // A campaign's address is network + name. No network given → look
          // the name up on each; two hits is a question for the caller.
          const found = (
            await Promise.all(
              (args.network ? [args.network] : AD_NETWORKS).map((n) =>
                parentCampaignMeta(n, args.name),
              ),
            )
          ).filter((m) => m !== null);
          if (found.length === 0) {
            throw new McpToolError(
              `No campaign named "${args.name}"${args.network ? ` on ${args.network}` : ""}. (An AD SET is read with level "ad_set" and its full stored name.)`,
            );
          }
          if (found.length > 1) {
            throw new McpToolError(
              `"${args.name}" is a campaign on ${found.map((m) => m.network).join(" and ")} — pass \`network\` to pick one.`,
            );
          }
          const parent = found[0]!;
          const range = { from: args.from, to: args.to };
          const [analytics, adSets, daily] = await Promise.all([
            campaignAnalytics({ parentId: parent.id }, range, args.include_excluded),
            parentCampaignAdSets(parent.id, range, args.include_excluded),
            parentCampaignDailyByAdSet(parent.id, range, args.include_excluded),
          ]);
          // A daily point is keyed by the ad set's id; its stored name is the
          // key the `adSets` rows (and get_campaign at level "ad_set") use.
          const storedNameOf = new Map(adSets.map((a) => [a.id, a.name]));
          return ok(brand, rangeEcho(args.from, args.to), {
            level: "campaign",
            campaign: {
              id: parent.id,
              name: parent.name,
              network: parent.network,
              status: parent.status,
              ad_sets: parent.adSets.length,
              objectives: [...new Set(parent.adSets.map((a) => a.objective))],
              platforms: [...new Set(parent.adSets.map((a) => a.platform))],
              products: parent.productNames,
              creativeCount: parent.creativeCount,
              firstDate: parent.firstDate,
              lastDate: parent.lastDate,
            },
            totals: analytics.totals,
            adSets: adSets.map((a) => ({
              // The ad set's full stored name — what get_campaign (level
              // "ad_set") and list_campaigns call `campaign`.
              campaign: a.name,
              ad_set: a.adsetName,
              platform: a.platform,
              objective: a.objective,
              status: a.status,
              has_data: a.spend !== null,
              creatives: a.spend !== null ? a.creatives : null,
              spend: r2(a.spend),
              orders: a.orders,
              revenue: r2(a.revenue),
              roas: r2(a.roas),
              cpa: r2(a.cpa),
              ctr: a.ctr,
              lastDate: a.lastDate,
            })),
            dailyByAdSet: daily.map((d) => ({
              date: d.date,
              // The ad set's label — its own name plus the platform tag, which
              // is what tells two Meta ad sets of one name apart — and the
              // full stored name, the key that joins a point to `adSets`.
              ad_set: d.creativeName,
              campaign: storedNameOf.get(d.creativeId) ?? null,
              spend: r2(d.spend),
              conversions: d.conversions,
              revenue: r2(d.conversionValue),
              roas: r2(d.roas),
            })),
          }, excludedEcho(args.include_excluded));
        }
        const meta = await campaignMeta(args.name);
        if (!meta) throw new McpToolError(`No ad set named "${args.name}".`);
        const range = { from: args.from, to: args.to };
        const [analytics, daily, statusMap] = await Promise.all([
          campaignAnalytics(args.name, range, args.include_excluded),
          campaignDailyByCreative(args.name, range, args.include_excluded),
          campaignStatusMap([meta.id]),
        ]);
        const status: string = campaignStatusFor(statusMap, meta.id);
        return ok(brand, rangeEcho(args.from, args.to), {
          level: "ad_set",
          campaign: {
            name: meta.campaign,
            // The CAMPAIGN this ad set sits under, and the ad set's own name.
            parent_campaign: meta.parent?.name ?? null,
            network: meta.parent?.network ?? null,
            ad_set: meta.adsetName,
            objective: meta.objective,
            platforms: meta.platforms,
            products: meta.productNames,
            creativeCount: meta.creativeCount,
            firstDate: meta.firstDate,
            lastDate: meta.lastDate,
            status,
          },
          totals: analytics.totals,
          dailyByCreative: daily.map((d) => ({
            date: d.date,
            creative: d.creativeName,
            spend: r2(d.spend),
            conversions: d.conversions,
            revenue: r2(d.conversionValue),
            roas: r2(d.roas),
          })),
        }, excludedEcho(args.include_excluded));
      }),
  );

  // 7 ─ get_summary ----------------------------------------------------------
  server.registerTool(
    "get_summary",
    {
      description: `The Summary table: per creative, a blended TOTAL block plus a per-platform breakdown, for a range. At most 5 platform columns. Capped at 500 rows. ${CONVENTIONS} ${ANGLES_RENAME}`,
      inputSchema: {
        brand: brandField,
        from: fromField,
        to: toField,
        platforms: platformsField,
        types: typesField,
        angles: anglesField,
        q: z.string().optional().describe("Search creatives (substring)."),
        include_excluded: includeExcludedField,
      },
    },
    async (args) =>
      withBrand(args.brand, async (brand) => {
        const ratingConfig = await getRatingConfig();
        const result = await listCreativeSummary({
          from: args.from,
          to: args.to,
          q: args.q,
          platforms: args.platforms,
          types: args.types,
          angles: args.angles,
          includeExcluded: args.include_excluded,
          ratingConfig,
        });
        const { rows, truncated } = capRows(result.rows);
        return ok(brand, rangeEcho(args.from, args.to), {
          platforms: result.platforms,
          truncated,
          rows: rows.map((row) => ({
            creativeId: row.creativeId,
            name: row.name,
            product: row.productName,
            type: row.type,
            status: row.generalStatus,
            total: {
              spend: r2(row.total.spend),
              conversions: row.total.conversions,
              revenue: r2(row.total.conversionValue),
              roas: r2(row.total.roas),
              cpa: r2(row.total.cpa),
              ctr: row.total.ctr,
              cvr: row.total.cvr,
            },
            perPlatform: Object.fromEntries(
              Object.entries(row.perPlatform).map(([p, b]) => [
                p,
                { spend: r2(b!.spend), roas: r2(b!.roas), conversions: b!.conversions },
              ]),
            ),
          })),
        }, excludedEcho(args.include_excluded));
      }),
  );

  // 8 ─ get_timeseries -------------------------------------------------------
  server.registerTool(
    "get_timeseries",
    {
      description: `Daily series broken down by platform, ad set or campaign, gap-filled (no-data days appear as 0) like the dashboard "over time" chart. Each point carries spend, conversions, revenue, CPA, ROAS. ${TWO_LEVELS} So \`dimension: "campaign"\` is one series per AD SET (keyed by its stored name) and \`dimension: "parent_campaign"\` one per CAMPAIGN (keyed by its name — "Name (Network)" only when the brand has that name on two ad networks), each a sum over its ad sets' records. ${CONVENTIONS}`,
      inputSchema: {
        brand: brandField,
        from: fromField,
        to: toField,
        dimension: z
          .enum(["platform", "campaign", "parent_campaign"])
          .default("platform")
          .describe(
            'Break the series down by "platform" (default), "campaign" (= the AD SET, the historical name) or "parent_campaign" (= the CAMPAIGN above the ad sets).',
          ),
        platforms: platformsField,
        productIds: productIdsField,
        include_excluded: includeExcludedField,
      },
    },
    async (args) =>
      withBrand(args.brand, async (brand) => {
        const filters: KpiFilters = {
          from: args.from,
          to: args.to,
          platforms: args.platforms,
          productIds: args.productIds,
          includeExcluded: args.include_excluded,
        };
        const dimension: BreakdownDimension = args.dimension;
        const series = await metricOverTime(filters, dimension);
        const { rows, truncated } = capRows(series);
        return ok(brand, rangeEcho(args.from, args.to), {
          dimension,
          truncated,
          points: rows.map((p) => ({
            date: p.date,
            key: p.key,
            spend: r2(p.spend),
            conversions: p.conversions,
            revenue: r2(p.conversionValue),
            cpa: r2(p.cpa),
            roas: r2(p.roas),
          })),
        }, excludedEcho(args.include_excluded));
      }),
  );

  // 9 ─ get_funnel -----------------------------------------------------------
  server.registerTool(
    "get_funnel",
    {
      description: `Funnel totals + rates for a range (impressions → clicks → LP views → add-to-cart → add-payment → conversions), with CPM/CTR/VOC/ATC-rate/AP-rate/purchase-rate/CvR and period-over-period deltas. Requires a date range. ${CONVENTIONS}`,
      inputSchema: {
        brand: brandField,
        from: z.string().regex(ISO).describe("Start date (YYYY-MM-DD). Required."),
        to: z.string().regex(ISO).describe("End date (YYYY-MM-DD). Required."),
        platforms: platformsField,
        productIds: productIdsField,
        include_excluded: includeExcludedField,
      },
    },
    async (args) =>
      withBrand(args.brand, async (brand) => {
        const overview = await funnelOverview({
          from: args.from,
          to: args.to,
          platforms: args.platforms,
          productIds: args.productIds,
          includeExcluded: args.include_excluded,
        });
        const c = overview.current;
        return ok(brand, rangeEcho(args.from, args.to), {
          volumes: {
            impressions: c.impressions,
            clicks: c.clicks,
            landingPageViews: c.landingPageViews,
            addToCart: c.addToCart,
            addPayment: c.addPayment,
            conversions: c.conversions,
            spend: r2(c.spend),
          },
          rates: {
            cpm: r2(c.cpm),
            ctr: c.ctr,
            voc: c.voc,
            atcRate: c.atcRate,
            apRate: c.apRate,
            purchaseRate: c.purchaseRate,
            cvr: c.cvr,
          },
        }, excludedEcho(args.include_excluded));
      }),
  );

  // 10 ─ get_data_freshness --------------------------------------------------
  server.registerTool(
    "get_data_freshness",
    {
      description:
        "Per platform, the latest date that has ANY performance record (the data horizon) plus the overall latest. Use this to caveat lag honestly — numbers for days after a platform's horizon are not-yet-uploaded, not zero. Dates are YYYY-MM-DD.",
      inputSchema: { brand: brandField },
    },
    async (args) =>
      withBrand(args.brand, async (brand) => {
        const [perPlatform, overall] = await Promise.all([
          platformHorizons(),
          dataHorizon(),
        ]);
        return ok(brand, null, {
          latestOverall: overall,
          latestPerPlatform: perPlatform,
        });
      }),
  );

  // 11 ─ diagnose_campaign ---------------------------------------------------
  server.registerTool(
    "diagnose_campaign",
    {
      description:
        `Returns a full diagnostic bundle for ONE AD SET (${TWO_LEVELS} The bundle's own wording still says "campaign" for it) PLUS embedded instructions — its daily series and weekly history, every creative in it with cross-ad-set context, this brand's same-platform benchmarks, the budget position, and the house conventions. FOLLOW THE EMBEDDED INSTRUCTIONS EXACTLY: interview the user for the data this system does not have (reach and frequency, explicitly) BEFORE concluding anything, then render the report as an artifact. This system does not diagnose — you do, from this bundle.`,
      inputSchema: {
        brand: brandField,
        campaign: z
          .string()
          .describe(
            "Exact stored name of the ad set — the `campaign` field of list_campaigns (default level).",
          ),
        window_days: z
          .number()
          .int()
          .min(7)
          .max(120)
          .optional()
          .default(30)
          .describe("How many days of DAILY detail to include (7-120, default 30). Everything before it arrives as weekly rollups."),
        include_excluded: includeExcludedField,
      },
    },
    async (args) =>
      withBrand(args.brand, async (brand) => {
        const input = await campaignDiagnosisInput(brand, args.campaign, {
          windowDays: args.window_days,
          includeExcluded: args.include_excluded,
          todayIso: todayIso(),
        });
        if (!input) {
          throw new McpToolError(
            `No ad set named "${args.campaign}" in ${brand.name}. This tool reads ONE AD SET by its full stored name ("Campaign ➤ Ad set") — call list_campaigns (default level) for the exact names.`,
          );
        }
        const bundle = serializeDiagnosis(input);
        return ok(
          brand,
          rangeEcho(input.window.from, input.window.to),
          bundle as unknown as Record<string, unknown>,
          excludedEcho(args.include_excluded),
        );
      }),
  );

  // 12 ─ list_products -------------------------------------------------------
  server.registerTool(
    "list_products",
    {
      description:
        "The brand's products with their ids — the values the `productIds` filter of the other tools takes. Archived products are left out unless include_archived is true (their past records still exist).",
      inputSchema: {
        brand: brandField,
        include_archived: z
          .boolean()
          .optional()
          .default(false)
          .describe("Also list archived products."),
      },
    },
    async (args) =>
      withBrand(args.brand, async (brand) => {
        const products = args.include_archived
          ? await listAllProductOptions()
          : await listProducts();
        return ok(brand, null, { products });
      }),
  );

  // 13 ─ get_budget ----------------------------------------------------------
  server.registerTool(
    "get_budget",
    {
      description:
        "One month of Budget, exactly as Budget → Today reads it: the plan against actual ad spend — the brand total, each platform and each planned objective bucket — with pacing, the month-end projection, the reserve (planned, used, remaining), the store-revenue target against actual revenue, orders, and ROAS (actual, target, projected). SPEND IS USD; REVENUE IS SAR (the store's currency); ROAS converts spend at the month's stored USD→SAR rate (`usd_to_sar_rate`). Pacing compares each platform through the days ITS data covers (not the calendar): `plan_to_date` is what the plan expected through that coverage and `deviation` = (actual − plan_to_date) ÷ plan_to_date (positive = ahead/overspending, negative = behind). Budget actuals are RAW totals — exclusions never apply here, by design. Revenue has no per-platform split in Budget. Each platform also carries `results` — PLATFORM-REPORTED purchases, purchase value (USD), ROAS (value ÷ spend) and CPA (spend ÷ purchases), over the same raw records and the same covered days as its `actual` spend; null = the platform doesn't report that field (never 0). These are the platforms' own claims, never compared with store revenue and with no target. Each platform row also says where its pace lands (`projected_month_end`) and what each remaining day must spend to land on plan (`needed_per_day`). `needs_attention` lists what wants a decision this month. Viewing a month with no plan returns has_plan: false with the actuals only.",
      inputSchema: {
        brand: brandField,
        month: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .optional()
          .describe("Month as YYYY-MM. Defaults to the current month (KSA)."),
      },
    },
    async (args) =>
      withBrand(args.brand, async (brand) => {
        const today = todayIso();
        const month = resolveBudgetMonth(args.month, today);
        const from = monthStartIso(month);
        const to = monthEndIso(month);
        const [plans, rate, platformCoverage, storeHorizon, series] = await Promise.all([
          budgetPlansForMonths([month]),
          getUsdToSarRate(),
          platformHorizons(),
          storeDataHorizon(),
          budgetPacingSeries(from, to),
        ]);
        // THE model Budget → Today draws (lib/budget-range.ts) — nothing is
        // re-derived here, so this tool and the page cannot disagree.
        const model = buildRangeModel({
          from,
          to,
          series,
          plans,
          rate,
          platforms: [],
          coverage: platformCoverage,
          storeHorizon,
          today,
        });
        const plan = model.monthPlan;
        const hasPlan = !!plan && (plan.allocations.length > 0 || plan.reserveSpendUsd > 0);
        const { spend, revenue, roas } = model.card;
        const reservePlanned = plan?.reserveSpendUsd ?? 0;
        const reserveUsedUsd = model.reserve.kind === "month" ? model.reserve.used : 0;
        const dayOfMonth = (iso: string | null) => (iso ? Number(iso.slice(8, 10)) : 0);
        const bar = (b: TrackerBar) => ({
          plan: r2(b.plan),
          plan_to_date: r2(b.planToDate),
          actual: r2(b.actual),
          delta: r2(b.delta),
          deviation: b.deviation,
          verdict: pacingVerdict(b.deviation),
        });
        return ok(brand, rangeEcho(from, to), {
          month,
          today,
          plan_mode: plan?.planMode ?? "curve",
          has_plan: hasPlan,
          usd_to_sar_rate: rate,
          day_of_month: elapsedDaysInMonth(month, today),
          days_in_month: daysInMonth(month),
          ads_data_through: latestCoverage(platformCoverage),
          ads_data_through_per_platform: platformCoverage,
          store_data_through: storeHorizon,
          spend_usd: {
            ...bar(spend.bar),
            projected_month_end: r2(spend.projected),
            projected_pct_of_plan:
              spend.projected !== null && spend.bar.plan > 0
                ? spend.projected / spend.bar.plan
                : null,
          },
          platforms_usd: model.board.platforms.map((p) => ({
            platform: p.key,
            ...bar(p),
            // Through this platform's own last covered day.
            data_through: p.lastData,
            projected_month_end: r2(p.projection),
            needed_per_day: r2(p.neededPerDay),
            buckets: p.buckets.map((b) => ({ objective: b.label, ...bar(b) })),
            unplanned: r2(p.unplanned),
            unplanned_buckets: p.unplannedBuckets.map((u) => ({
              objective: u.label,
              actual: r2(u.actual),
            })),
            results: {
              source: "platform-reported" as const,
              purchases: p.results.purchases,
              purchase_value_usd: p.results.purchaseValue,
              roas: r2(p.results.roas),
              cpa_usd: p.results.cpa,
            },
          })),
          unplanned_total_usd: r2(model.board.platforms.reduce((sum, p) => sum + p.unplanned, 0)),
          reserve_usd: {
            planned: r2(reservePlanned),
            used: r2(reserveUsedUsd),
            remaining: r2(Math.max(0, reservePlanned - reserveUsedUsd)),
          },
          revenue_sar: {
            target: r2(revenue.bar.plan),
            ...bar(revenue.bar),
            projected_month_end: r2(revenue.projected),
          },
          orders: series.days.reduce((sum, d) => sum + d.orders, 0),
          roas: {
            actual: r2(roas.actual),
            target: r2(roas.target),
            projected: r2(roas.projected),
            deviation:
              roas.actual !== null && roas.target !== null
                ? pacingDeviation(roas.actual, roas.target)
                : null,
            // Revenue and spend both cut at this day of the month.
            through_day: dayOfMonth(roas.through),
          },
          // What Today's "Needs attention" list shows, as data: platforms
          // more than 15% off pace (with the run-rate over REPORTED days and
          // what each remaining day needs), a projected reserve overshoot at
          // month end, spend with no plan, and stale uploads. Empty for a
          // month that is over or hasn't started.
          needs_attention: buildAttention(model, platformCoverage, today),
        });
      }),
  );

  // 13b ─ get_budget_review --------------------------------------------------
  server.registerTool(
    "get_budget_review",
    {
      description:
        "Budget months compared, exactly as Budget → Review reads them: for each of the last N months (default 12, ending with the current one) the actual ad spend against the plan the month ENDED with (`plan_usd`) AND the first plan saved for it (`first_plan_usd`) — a plan revised late always matches what was spent, so the gap between `vs_plan` and `vs_first_plan` is how far the plan was moved to meet reality. Also store revenue against its target (SAR), store ROAS against target, the reserve planned and used, and how many times the plan was saved. Deviations are (actual − base) ÷ base; only CLOSED months (`state: \"final\"`) are judged — the running month carries `pace_to_date` instead. `summary` aggregates the closed months; `plan_changes` is the newest plan revisions (who, when, note, planned total). SPEND IS USD, REVENUE IS SAR; actuals are RAW (exclusions never apply in Budget).",
      inputSchema: {
        brand: brandField,
        months: z
          .number()
          .int()
          .min(1)
          .max(24)
          .optional()
          .describe("How many months to look back over, ending with the current month. Default 12."),
      },
    },
    async (args) =>
      withBrand(args.brand, async (brand) => {
        const today = todayIso();
        const months: string[] = [];
        let cursor = monthKey(today);
        for (let i = 0; i < (args.months ?? 12); i++) {
          months.unshift(cursor);
          cursor = prevMonthKey(cursor);
        }
        const from = monthStartIso(months[0]!);
        const to = monthEndIso(months.at(-1)!);
        const [series, plans, rate, coverage, storeHorizon, stats, log] = await Promise.all([
          budgetPacingSeries(from, to),
          budgetPlansForMonths(months),
          getUsdToSarRate(),
          platformHorizons(),
          storeDataHorizon(),
          planRevisionStats(months),
          listPlanRevisionLog(months, 20),
        ]);
        const { rows, summary } = buildMonthReview({
          months,
          series,
          plans,
          stats,
          rate,
          coverage,
          storeHorizon,
          today,
        });
        return ok(brand, rangeEcho(from, to), {
          usd_to_sar_rate: rate,
          summary: {
            closed_months_with_plan: summary.closed,
            months_within_15pct_of_plan: summary.onPlan,
            spend_vs_plan: summary.vsPlan,
            spend_vs_first_plan: summary.vsFirst,
            revenue_vs_target: summary.vsRevenue,
          },
          months: rows.map((r) => ({
            month: r.month,
            state: r.state,
            has_plan: r.hasPlan,
            spend_usd: r2(r.actual),
            plan_usd: r2(r.plan),
            first_plan_usd: r2(r.firstPlan),
            vs_plan: r.vsPlan,
            vs_first_plan: r.vsFirst,
            pace_to_date: r.paceToDate,
            revenue_sar: r2(r.revenue),
            revenue_target_sar: r2(r.revenueTarget),
            revenue_vs_target: r.vsRevenue,
            roas: r2(r.roas),
            roas_target: r2(r.roasTarget),
            reserve_usd: { planned: r2(r.reserve), used: r2(r.reserveUsed) },
            plan_saves: r.revisions,
          })),
          plan_changes: log.map((r) => ({
            month: r.month,
            saved_at: r.createdAt,
            saved_by: r.savedBy,
            note: r.note,
            planned_total_usd: r.readable ? r2(r.plannedTotal + r.reserveSpendUsd) : null,
            mode: r.mode,
          })),
        });
      }),
  );

  // 14 ─ get_store -----------------------------------------------------------
  server.registerTool(
    "get_store",
    {
      description:
        "The Store module for a range (defaults to the app's last 30 days): store orders and revenue — MONEY IS SAR here, never USD — per day and in total, split by the ad platform the order's UTM source maps to and by sales channel (website / application), plus Reconciliation: store orders against the conversions each ad platform CLAIMS, as COUNTS ONLY (Reconciliation never compares revenue). `delta` = claimed − store orders (positive = the platform over-claims); `delta_pct` and `match_rate` use store orders as the base and are null when the store recorded none. Orders whose source maps to no platform are `unattributed`. `salla_feed` says whether orders arrive automatically from Salla (`connected`) and when the last one did; a brand without it relies on manual uploads. `by_payment_method` splits orders by Salla's payment method (cod, mada, tabby_installment, tamara_installment, credit_card…; 'not reported' = an uploaded order or one Salla sent without it). `by_offer` splits orders by the Salla SPECIAL OFFER applied (e.g. buy two, the third free; several on one order are joined with ', '); 'no offer' = none, or an order Salla sent before 2026-11-23 13:42 Riyadh that has not been pulled again — before then offers arrived inside coupons. Coupons are not offers. Every `by_*` split (payment method, offer, Salla `status` slug, `city`, `coupon_code`, `shipping_company`; the top 10–20 values by orders) carries `lost_orders` = its orders cancelled, deleted or refunded; `by_shipping_company.avg_days_to_deliver` = order day → Salla's delivered day, over delivered orders only. `outcomes` counts cancelled (incl. deleted) and refunded orders — they still count in every total. `customers` splits orders into a customer's FIRST order with the brand (`new_orders`) and later ones (`returning_orders`) — a customer is their phone, else their Salla customer id; `history_from` is the brand's first order, before which no history exists — `repeat_customers_in_range` = customers with 2+ orders in the range. `promotions_sar` = what coupons and special offers gave away (excl. VAT) and the sale-price markdown. `gross_profit` covers every product in the range (same rule as top_products; `margin` = gross profit ÷ costed sales before VAT). `top_products` = the 10 best-selling products in the range by quantity (a product is its SKU, which carries the colour), with the orders they appear in, `sales_sar` = their line totals incl. VAT, `cogs_sar` = units × the unit cost the brand entered (Store → Product costs) in force on each order's date, and `gross_profit_sar` = sales BEFORE VAT (÷1.15) − COGS over the units that have a cost (null when none do; `units_without_cost` counts the rest, which are outside both figures); `sale_discount_sar` = the Salla SALE-PRICE markdown on those units, EXCL. VAT: Σ (regular price − price sold at) × units — separate from coupons and offers; lines Salla sent before 2026-11-23 14:46 Riyadh and not pulled since count 0. Every order counts whatever its status. Only Salla-feed orders carry products: `orders_without_products` counts the range's orders (uploads) the list can't see. A brand that has no store orders returns zeros — call get_data_freshness / see `store_data_through` before reading a gap as a real zero.",
      inputSchema: {
        brand: brandField,
        from: fromField,
        to: toField,
        include_excluded: z
          .boolean()
          .optional()
          .default(false)
          .describe("Count ad records marked excluded-from-aggregates on the CLAIMED side of Reconciliation. Store orders are never excluded."),
      },
    },
    async (args) =>
      withBrand(args.brand, async (brand) => {
        const range = defaultRange(args.from, args.to);
        const [daily, byPlatform, byChannel, overview, recon, storeHorizon, connection, top, kpis, sections, productTotals] =
          await Promise.all([
            storeInsightsDaily(range.from, range.to),
            storeInsightsBreakdown(PLATFORM_LENS, range.from, range.to),
            storeInsightsBreakdown(CHANNEL_LENS, range.from, range.to),
            reconciliationOverview(range.from, range.to, args.include_excluded),
            reconciliationByPlatform(
              STORE_SOURCE_FIELD_KEY,
              range.from,
              range.to,
              args.include_excluded,
            ),
            storeDataHorizon(),
            storeConnectionStatus(),
            storeTopProducts(range.from, range.to),
            // The Insights page's own scans (2026-11-27), unfiltered: one
            // headline row and the six section lenses in one GROUP BY each.
            storeInsightsKpis(range.from, range.to),
            storeInsightsSections(range.from, range.to),
            storeInsightsProducts(range.from, range.to, {}, 0),
          ]);
        const lensRows = (lens: SectionLens, name: string, blank: string, top = 10) =>
          [...sections.lenses[lens]]
            .sort((a, b) => b.orders - a.orders)
            .slice(0, top)
            .map((b) => ({
              [name]: b.value ?? blank,
              orders: b.orders,
              revenue_sar: r2(b.revenue),
              lost_orders: b.lost,
            }));
        const gp = grossProfit(productTotals.total);
        let orders = 0;
        let revenue = 0;
        for (const d of daily) {
          orders += d.orders;
          revenue += d.revenue;
        }
        const sums = sumPlatformDays(recon.rows, platformEnum);
        const claimedTotal = overview.reduce((a, r) => a + r.platformConv, 0);
        const bucketName = (v: string | null) =>
          v === null || v === UNATTRIBUTED ? "unattributed" : v;
        return ok(
          brand,
          rangeEcho(range.from, range.to),
          {
            store_data_through: storeHorizon,
            salla_feed: connection
              ? {
                  connected: true,
                  last_order_received_at: connection.lastEventAt,
                  last_catch_up_at: connection.lastPullAt,
                  catch_up_failed: connection.lastPullError !== null,
                  orders_today: connection.ordersToday,
                }
              : { connected: false },
            totals_sar: {
              orders,
              revenue: r2(revenue),
              aov: orders > 0 ? r2(revenue / orders) : null,
            },
            by_platform: byPlatform.rows.map((b) => ({
              platform: bucketName(b.value),
              orders: b.orders,
              revenue_sar: r2(b.revenue),
            })),
            by_payment_method: lensRows("payment", "payment_method", "not reported", 20),
            by_offer: lensRows("offer", "offer", "no offer", 20),
            by_status: lensRows("status", "status", "not reported", 20),
            by_city: lensRows("city", "city", "not reported"),
            by_coupon: lensRows("coupon", "coupon_code", "no coupon"),
            by_shipping_company: [...sections.lenses.shipping]
              .sort((a, b) => b.orders - a.orders)
              .slice(0, 10)
              .map((b) => ({
                shipping_company: b.value ?? "not reported",
                orders: b.orders,
                lost_orders: b.lost,
                avg_days_to_deliver:
                  avgDeliveryDays(b) === null ? null : Math.round(avgDeliveryDays(b)! * 10) / 10,
              })),
            outcomes: {
              cancelled_orders: kpis.cancelled,
              refunded_orders: kpis.refunded,
            },
            customers: {
              new_orders: kpis.newOrders,
              new_revenue_sar: r2(kpis.newRevenue),
              returning_orders: kpis.returningOrders,
              returning_revenue_sar: r2(kpis.returningRevenue),
              orders_without_customer: kpis.unknownCustomerOrders,
              customers: kpis.customers,
              repeat_customers_in_range: kpis.repeatCustomers,
              history_from: kpis.historyFrom,
            },
            promotions_sar: {
              coupon_orders: kpis.couponOrders,
              coupon_discount: r2(kpis.couponDiscount),
              offer_orders: kpis.offerOrders,
              offer_discount: r2(kpis.offerDiscount),
              sale_price_markdown: r2(productTotals.total.markdown),
            },
            gross_profit: {
              sales_sar: r2(productTotals.total.sales),
              costed_sales_before_vat_sar: r2(productTotals.total.costedSalesExVat),
              cogs_sar: r2(productTotals.total.cogs),
              gross_profit_sar: gp.profit === null ? null : r2(gp.profit),
              margin: gp.margin,
              units_without_cost: productTotals.total.unitsWithoutCost,
            },
            by_channel: byChannel.rows.map((b) => ({
              channel: b.value ?? "unmapped",
              orders: b.orders,
              revenue_sar: r2(b.revenue),
            })),
            daily_sar: daily.map((d) => ({
              date: d.day,
              orders: d.orders,
              revenue: r2(d.revenue),
            })),
            top_products: {
              rows: top.rows.map((p) => ({
                sku: p.sku,
                name: p.name,
                quantity: p.quantity,
                orders: p.orders,
                sales_sar: r2(p.sales),
                cogs_sar: r2(p.cogs),
                gross_profit_sar: p.grossProfit === null ? null : r2(p.grossProfit),
                units_without_cost: p.unitsWithoutCost,
                sale_discount_sar: r2(p.saleDiscount),
              })),
              orders_without_products: top.ordersWithoutProducts,
            },
            reconciliation: {
              store_orders: sums.storeOrders,
              claimed_conversions: claimedTotal,
              delta: reconDelta(sums.storeOrders, claimedTotal),
              delta_pct: reconDeltaPct(sums.storeOrders, claimedTotal),
              match_rate: reconMatchRate(sums.storeOrders, claimedTotal),
              unattributed_orders: sums.unattributed,
              unmapped_source_values: recon.unmappedValues,
              by_platform: platformEnum.map((p) => {
                const store = sums.store[p] ?? 0;
                const claimed = sums.claimed[p] ?? 0;
                return {
                  platform: p,
                  store_orders: store,
                  claimed_conversions: claimed,
                  delta: reconDelta(store, claimed),
                  delta_pct: reconDeltaPct(store, claimed),
                  match_rate: reconMatchRate(store, claimed),
                };
              }),
              daily: overview.map((r) => ({
                date: r.day,
                store_orders: r.storeOrders,
                claimed_conversions: r.platformConv,
              })),
            },
          },
          excludedEcho(args.include_excluded),
        );
      }),
  );

  // 15 ─ get_landing_pages ---------------------------------------------------
  server.registerTool(
    "get_landing_pages",
    {
      description: `Ad performance per landing page for a range (defaults to the app's last 30 days). An ad name ending in " @code" sends traffic to that registered landing page; a row with landing_page null is the PRODUCT's own page (no code). Each row is one (product, landing page), optionally split by platform. Pass \`code\` for ONE landing page in depth instead — what its detail page shows: totals, by platform, by AD SET (\`by_campaign\` — ${TWO_LEVELS} Each row is ONE ad set: \`campaign\` its full stored name, \`ad_set\` its own name, \`parent_campaign\` + \`network\` the CAMPAIGN above it, with the ad set's objective) and by creative (all platforms, google included). ${CONVENTIONS}`,
      inputSchema: {
        brand: brandField,
        from: fromField,
        to: toField,
        platforms: platformsField,
        productIds: productIdsField,
        by_platform: z
          .boolean()
          .optional()
          .default(false)
          .describe("Split every landing page's row by platform."),
        code: z
          .string()
          .optional()
          .describe('One landing page\'s code (with or without the "@") — returns that page in depth instead of the list.'),
        include_excluded: includeExcludedField,
      },
    },
    async (args) =>
      withBrand(args.brand, async (brand) => {
        const range = defaultRange(args.from, args.to);
        if (args.code !== undefined) {
          const code = args.code.trim().replace(/^@/, "");
          const page = await getLandingPageByCode(code);
          if (!page) throw new McpToolError(`No landing page with code "@${code}".`);
          const scope: KpiFilters = {
            landingPageIds: [page.id],
            from: range.from,
            to: range.to,
            includeExcluded: args.include_excluded,
          };
          const [totals, byPlatform, byCampaign, creativeRows] = await Promise.all([
            kpis(scope),
            platformMix(scope),
            campaignMix(scope),
            landingPageCreatives(page.id, range, args.include_excluded ?? false),
          ]);
          const capped = capRows(creativeRows);
          return ok(
            brand,
            rangeEcho(range.from, range.to),
            {
              landing_page: {
                name: page.name,
                code: page.code,
                url: page.url,
                description: page.description,
                product: page.productName,
              },
              totals: {
                spend: r2(totals.spend),
                impressions: totals.impressions,
                clicks: totals.clicks,
                landing_page_views: totals.landingPageViews,
                conversions: totals.conversions,
                revenue: r2(totals.conversionValue),
                ctr: totals.ctr,
                cpm: r2(totals.cpm),
                cpa: r2(totals.cpa),
                roas: r2(totals.roas),
                cvr: totals.cvr,
              },
              by_platform: byPlatform.map((m) => ({
                platform: m.platform,
                spend: r2(m.spend),
                conversions: m.conversions,
                revenue: r2(m.conversionValue),
                cpa: r2(m.cpa),
                roas: r2(m.roas),
                ctr: m.ctr,
                cvr: m.cvr,
              })),
              // One row per AD SET (the key predates the two levels).
              by_campaign: byCampaign.map((m) => ({
                campaign: m.campaign,
                ad_set: adSetParts(m.campaign, m.platform).ad_set,
                parent_campaign: m.parentCampaign,
                network: m.network,
                objective: m.objective,
                platform: m.platform,
                spend: r2(m.spend),
                conversions: m.conversions,
                revenue: r2(m.conversionValue),
                cpa: r2(m.cpa),
                roas: r2(m.roas),
                ctr: m.ctr,
              })),
              truncated: capped.truncated,
              by_creative: capped.rows.map((c) => ({
                creative: c.name,
                product: c.productName,
                status: c.status,
                spend: r2(c.spend),
                conversions: c.conversions,
                revenue: r2(c.conversionValue),
                cpa: r2(c.cpa),
                roas: r2(c.roas),
                ctr: c.ctr,
                cvr: c.cvr,
              })),
            },
            excludedEcho(args.include_excluded),
          );
        }
        const all = await landingPageRollup(
          {
            from: range.from,
            to: range.to,
            platforms: args.platforms,
            productIds: args.productIds,
            includeExcluded: args.include_excluded,
          },
          { byPlatform: args.by_platform },
        );
        const { rows, truncated } = capRows(all);
        return ok(
          brand,
          rangeEcho(range.from, range.to),
          {
            truncated,
            landing_pages: rows.map((r) => ({
              product: r.productName,
              landing_page: r.landingPageId === null ? null : { name: r.name, code: r.code, url: r.url },
              platform: r.platform,
              creatives: r.creatives,
              spend: r2(r.spend),
              impressions: r.impressions,
              clicks: r.clicks,
              landing_page_views: r.landingPageViews,
              conversions: r.conversions,
              revenue: r2(r.conversionValue),
              ctr: r.ctr,
              cpc: r2(r.cpc),
              cpm: r2(r.cpm),
              cpa: r2(r.cpa),
              roas: r2(r.roas),
              cvr: r.cvr,
            })),
          },
          excludedEcho(args.include_excluded),
        );
      }),
  );

  // 16 ─ get_trends ----------------------------------------------------------
  server.registerTool(
    "get_trends",
    {
      description: `What is working, by CONCEPT: performance rolled up by angle (each with the same metrics for the prior equal-length window, for "vs previous") and by creative type (video / image / slides, optionally per platform), for a range (defaults to the app's last 30 days). A creative carrying several angles counts under each of them, so angle rows do not sum to the brand total. ${CONVENTIONS}`,
      inputSchema: {
        brand: brandField,
        from: fromField,
        to: toField,
        platforms: platformsField,
        productIds: productIdsField,
        types_by_platform: z
          .boolean()
          .optional()
          .default(false)
          .describe("Split the creative-type rollup by platform."),
        include_excluded: includeExcludedField,
      },
    },
    async (args) =>
      withBrand(args.brand, async (brand) => {
        const range = defaultRange(args.from, args.to);
        const f = {
          from: range.from,
          to: range.to,
          platforms: args.platforms,
          productIds: args.productIds,
          includeExcluded: args.include_excluded,
        };
        const [angles, types] = await Promise.all([
          angleRollup(f),
          typeRollup(f, { byPlatform: args.types_by_platform }),
        ]);
        const metrics = (m: {
          creatives: number;
          spend: number;
          impressions: number;
          clicks: number;
          conversions: number;
          revenue: number;
          ctr: number | null;
          cvr: number | null;
          cpa: number | null;
          cpm: number | null;
          cpc: number | null;
          roas: number | null;
        }) => ({
          creatives: m.creatives,
          spend: r2(m.spend),
          impressions: m.impressions,
          clicks: m.clicks,
          conversions: m.conversions,
          revenue: r2(m.revenue),
          ctr: m.ctr,
          cvr: m.cvr,
          cpa: r2(m.cpa),
          cpm: r2(m.cpm),
          cpc: r2(m.cpc),
          roas: r2(m.roas),
        });
        const capped = capRows(angles);
        return ok(
          brand,
          rangeEcho(range.from, range.to),
          {
            truncated: capped.truncated,
            by_angle: capped.rows.map((a) => ({
              angle: a.angle,
              ...metrics(a),
              landing_page_views: a.landingPageViews,
              prev: a.prev ? metrics(a.prev) : null,
            })),
            by_type: types.map((t) => ({
              type: t.type,
              platform: t.platform,
              creatives: t.creatives,
              spend: r2(t.spend),
              impressions: t.impressions,
              clicks: t.clicks,
              ctr: t.ctr,
              cpc: r2(t.cpc),
              cpa: r2(t.cpa),
              roas: r2(t.roas),
              cvr: t.cvr,
            })),
          },
          excludedEcho(args.include_excluded),
        );
      }),
  );

  // ── Canvas patterns (2026-11-20) ─────────────────────────────────────────
  // The Canvas insight strip as data: the SAME `canvasGraph` + `canvasInsights`
  // the page draws (statuses = the Canvas default, everything but Terminated),
  // each pattern's entities detailed through `inspectFor` — no new math.
  server.registerTool(
    "get_canvas_patterns",
    {
      description: `The Canvas's campaign↔creative patterns for a range (defaults to the app's last 30 days), exactly as the Canvas insight strip shows them. A "pairing" is one creative inside one campaign; its Rate is the brand's Rate rule (Good / Decent / Bad by ROAS, N/A under the minimum spend; the override of the platform the pairing ran on applies) over the pairing's own range spend and revenue. Patterns (absent when empty): no_live_creatives — campaigns where nothing is spending now; idle_active — active creatives with no spend in the range; losing_everywhere — creatives rated Bad in 2+ campaigns and Good/Decent in none; leans_on_one — campaigns with 2+ creatives where one took ≥70% of the spend; unscaled_winner — creatives in ONE campaign whose pairing is rated Good and still live; launched — creatives and campaigns whose first-ever spend falls inside the range (first_spend_day; judged under the platforms filter and include_excluded); most_shared — the creative feeding the most campaigns. Terminated creatives are left out, as on the Canvas. ${TWO_LEVELS} So at the default \`level: "ad_set"\` every "campaign" above is an AD SET (the Canvas's default); \`level: "campaign"\` reads the same patterns per CAMPAIGN — a campaign's ad sets folded into one pairing per creative (its spend and revenue summed; live when it is still spending on any of its platforms; rated by its platform's rules, or the brand default when it ran on two) — and each campaign item carries \`network\` and \`ad_sets\`. ${CONVENTIONS}`,
      inputSchema: {
        brand: brandField,
        from: fromField,
        to: toField,
        platforms: platformsField,
        productIds: productIdsField,
        level: z
          .enum(["ad_set", "campaign"])
          .default("ad_set")
          .describe(
            'What a "campaign" in the patterns is: "ad_set" (default, the Canvas\'s default) or "campaign" (each campaign\'s ad sets folded together).',
          ),
        include_excluded: includeExcludedField,
      },
    },
    async (args) =>
      withBrand(args.brand, async (brand) => {
        const range = defaultRange(args.from, args.to);
        const graph = await canvasGraph({
          from: range.from,
          to: range.to,
          platforms: args.platforms && args.platforms.length > 0 ? args.platforms : undefined,
          statuses: CANVAS_DEFAULT_STATUSES,
          productIds: args.productIds && args.productIds.length > 0 ? args.productIds : undefined,
          includeExcluded: args.include_excluded,
          level: args.level === "campaign" ? "campaign" : "adset",
        });
        const detail = (id: string) => inspectFor(id, graph);
        const pairing = (p: InspectorPairing) => ({
          name: p.other.name,
          spend: r2(p.edge.spend),
          roas: r2(p.edge.roas),
          rate: p.edge.rate,
          live: p.edge.live,
          last_spend_day: p.edge.lastSpendDay,
        });
        const items = (key: CanvasInsight["key"], ids: string[]) =>
          ids.flatMap((id) => {
            const d = detail(id);
            if (!d) return [];
            const n = d.node;
            const base = {
              kind: n.kind,
              name: n.name,
              status: n.status,
              spend: r2(n.spend),
              roas: r2(d.roas),
              // A CAMPAIGN (level "campaign") says which network it is on and
              // how many ad sets it has — its name is unique only per network.
              ...(n.kind === "campaign" && n.level === "campaign"
                ? { network: n.network, ad_sets: n.adSets }
                : {}),
            };
            switch (key) {
              case "losing-everywhere":
                return [{ ...base, bad_in: d.pairings.filter((p) => p.edge.rate === "bad").map(pairing) }];
              case "leans-on-one": {
                const top = [...d.pairings].sort((a, b) => b.edge.spend - a.edge.spend)[0];
                return [{
                  ...base,
                  creatives_in_range: n.kind === "campaign" ? n.totalChildren : null,
                  top_creative: top ? pairing(top) : null,
                  top_share: top?.share !== undefined && top.share !== null ? r2(top.share) : null,
                }];
              }
              case "unscaled-winner":
                return [{ ...base, campaign: d.pairings[0] ? pairing(d.pairings[0]) : null }];
              case "launched":
                return [{ ...base, first_spend_day: n.launchedOn }];
              case "most-shared":
                return [{ ...base, campaigns: d.pairings.map(pairing) }];
              case "no-live-creatives":
                return [{ ...base, creatives_in_range: n.kind === "campaign" ? n.totalChildren : null }];
              case "idle-active":
                return [base];
            }
          });
        return ok(
          brand,
          rangeEcho(range.from, range.to),
          {
            // What a "campaign" item below IS — an ad set, or a campaign.
            level: graph.level === "campaign" ? "campaign" : "ad_set",
            // Set when the Canvas's size cap trimmed the graph: patterns are
            // computed over what the Canvas draws, as on the page.
            truncated: graph.truncated
              ? {
                  shown_pairings: graph.truncated.shownEdges,
                  total_pairings: graph.truncated.totalEdges,
                }
              : null,
            patterns: canvasInsights(graph).map((i) => ({
              key: i.key.replaceAll("-", "_"),
              label: i.label,
              items: items(i.key, i.focusIds),
            })),
          },
          excludedEcho(args.include_excluded),
        );
      }),
  );

  // ── Pricing · Actual CML (2026-11-27, user decision) ─────────────────────
  // The ONE Pricing surface the MCP reads: the SAME facts, mappings and
  // `computeActual` the Actual page runs, against a version's active plan.
  // Gated on `price_structure.view` like the page — the module's three grants
  // are the only door into it, on the MCP as in the app.
  server.registerTool(
    "get_actual_cml",
    {
      description:
        "Pricing · Actual: the REAL contribution margin left (CML) for a range (defaults to the app's last 30 days), from the Store's orders, Store → Product costs and the Ads uploads' spend. MONEY IS SAR BEFORE VAT here (ad spend is converted from USD at the version's rate; `ad_spend_usd` keeps the raw figure). CML = net revenue − COGS − ad spend. Net revenue = what customers paid for products after coupons and offers, plus shipping and COD fees, before VAT; the real shipping cost is NOT deducted. Delivered orders count in full; lost orders (cancelled, deleted, refunded) count for nothing but their ad spend still counts; open orders count at their payment method's delivery rate over the last 90 days of closed orders (`rate_from`: method — 20+ closed orders; brand — the brand's overall rate; version — the version's setting); uploaded orders with no status count at the brand's rate. `cml_settled` = delivered orders minus all ad spend; `cml_expected` = what open and uploaded orders are expected to add. COGS = units × the cost in force on the order's day. CML is WITHHELD (null, `complete: false`, see `incomplete_because`) while a delivered or open unit has no cost or an order carries no products — never guess it. `products` groups SKUs by the Pricing product they are mapped to (per brand), each with its offers by quantity; `skus_not_mapped` and `ad_spend_not_mapped` still count in every total. `plan_bridge` walks the version's ACTIVE plan × the range's days to the actual CML (plan, volume, mix, delivery, price, cogs, ads, not_in_plan, actual; the steps sum to the gap). `version` picks the Pricing version by name or id; omitted = the one you opened last in the app, else the most recently opened. Requires the price_structure.view permission.",
      inputSchema: {
        brand: brandField,
        from: fromField,
        to: toField,
        version: z
          .string()
          .optional()
          .describe("Pricing version name or id. Omit for the one you opened last in the app."),
      },
    },
    async (args) =>
      withBrand(args.brand, async (brand) => {
        const { user } = currentActor();
        if (!priceStructureAccess(user)) {
          throw new McpToolError(`Pricing needs the ${PS_VIEW_PERM} permission. Ask an admin to grant it.`);
        }
        const versions = await listVersions(brand.id);
        if (versions.length === 0) {
          throw new McpToolError("This brand has no Pricing version yet — open Pricing in the app to create one.");
        }
        let version = versions[0]!;
        if (args.version) {
          const needle = args.version.trim().toLowerCase();
          const match = versions.find((v) => v.id === args.version || v.name.trim().toLowerCase() === needle);
          if (!match) {
            throw new McpToolError(
              `Unknown Pricing version "${args.version}". Versions: ${versions.map((v) => v.name).join(", ")}.`,
            );
          }
          version = match;
        } else {
          const last = await getLastVersionId(user.id, brand.id);
          version = versions.find((v) => v.id === last) ?? version;
        }
        const range = defaultRange(args.from, args.to);
        const ratesFrom = shiftIso(range.to, -(RATE_WINDOW_DAYS - 1));
        const facts = await actualFacts(range.from, range.to, ratesFrom);
        const mappings = await actualMappings();
        const plan = version.data.plans.find((p) => p.id === version.data.activePlanId) ?? null;
        const result = computeActual(facts, mappings, version.data, plan);
        return ok(brand, rangeEcho(range.from, range.to), {
          ...actualCmlPayload(result, version, plan),
          delivery_rates_from: { from: facts.ratesFrom, to: facts.ratesTo },
        });
      }),
  );
}

/**
 * Campaign/portfolio tools require a bounded range; the default is the app's
 * own "Last 30 days" (`defaultDateRange(30)`: the 30 days ending YESTERDAY in
 * KSA), so the model is handed a window the app actually shows (C-25). One
 * bound given: the other makes the same 30-day window around it.
 */
function defaultRange(from?: string, to?: string): { from: string; to: string } {
  if (from && to) return { from, to };
  if (!from && !to) return defaultDateRange(30);
  if (to) return { from: shiftIso(to, -29), to };
  return { from: from!, to: shiftIso(from!, 29) };
}
