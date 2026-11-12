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
  type PortfolioFilters,
} from "@/db/queries/portfolio";
import {
  campaignMeta,
  campaignAnalytics,
  campaignDailyByCreative,
  campaignRegistry,
} from "@/db/queries/campaign";
import { creativeStatusMap, statusFor } from "@/db/queries/creative-status";
import { campaignStatusMap, campaignStatusFor } from "@/db/queries/campaign-status";
import { listCreativeSummary } from "@/db/queries/summary";
import { getRatingConfig } from "@/db/queries/rating";
import { funnelOverview } from "@/db/queries/funnel";
import { platformHorizons, dataHorizon } from "@/db/queries/series-bounds";
import { campaignDiagnosisInput } from "@/db/queries/diagnosis";
import { budgetPacingSeries, getBudgetMonth } from "@/db/queries/budget";
import { storeDataHorizon } from "@/db/queries/series-bounds";
import { storeInsightsBreakdown, storeInsightsDaily } from "@/db/queries/store-insights";
import { reconciliationByPlatform, reconciliationOverview } from "@/db/queries/reconciliation";
import { landingPageRollup } from "@/db/queries/landing-page-performance";
import { getLandingPageByCode, landingPageCreatives } from "@/db/queries/landing-pages";
import { angleRollup, typeRollup } from "@/db/queries/trends";
import { listAllProductOptions, listProducts } from "@/db/queries/products";
import {
  REVENUE_COVERAGE_KEY,
  buildTrackerRows,
  latestCoverage,
  makeCoverageDay,
  monthEndIso,
  monthRoasActuals,
  monthStartIso,
  pacingVerdict,
  roasFigures,
  type TrackerBar,
} from "@/lib/budget";
import { resolveBudgetMonth } from "@/validators/budget";
import { CHANNEL_LENS, PLATFORM_LENS } from "@/lib/store-insights";
import { reconDelta, reconDeltaPct, reconMatchRate, sumPlatformDays } from "@/lib/reconciliation";
import { STORE_SOURCE_FIELD_KEY } from "@/store/fields";
import { UNATTRIBUTED } from "@/store/sources";
import { serializeDiagnosis } from "@/lib/diagnosis";
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
      description: `One creative in depth: fields, manual funnel stage(s), angles, per-platform status, and its per-campaign performance breakdown (all-time unless a range is given). ${CONVENTIONS} ${ANGLES_RENAME}`,
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
      description: `The campaign portfolio: per campaign — status (active/inactive), objective, platform(s), and KPIs (spend, orders, revenue, ROAS, CPA, CTR) for a range (defaults to last 30 days). Capped at 500 rows. ${CONVENTIONS}`,
      inputSchema: {
        brand: brandField,
        from: fromField,
        to: toField,
        platforms: platformsField,
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
        const all = await portfolioCampaigns(filters);
        const { rows, truncated } = capRows(all);
        return ok(brand, rangeEcho(range.from, range.to), {
          count: all.length,
          truncated,
          campaigns: rows.map((c) => ({
            id: c.campaignId,
            campaign: c.campaign,
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
      description: `One campaign: totals + KPIs for a range, its liveness status, and the gap-filled daily per-creative series (the exact points the campaign chart draws). ${CONVENTIONS}`,
      inputSchema: {
        brand: brandField,
        name: z.string().describe("Exact campaign name (as in list_campaigns)."),
        from: fromField,
        to: toField,
        include_excluded: includeExcludedField,
      },
    },
    async (args) =>
      withBrand(args.brand, async (brand) => {
        const meta = await campaignMeta(args.name);
        if (!meta) throw new McpToolError(`No campaign named "${args.name}".`);
        const range = { from: args.from, to: args.to };
        const [analytics, daily, registry] = await Promise.all([
          campaignAnalytics(args.name, range, args.include_excluded),
          campaignDailyByCreative(args.name, range, args.include_excluded),
          campaignRegistry(args.name),
        ]);
        let status: string | null = null;
        if (registry) {
          const m = await campaignStatusMap([registry.id]);
          status = campaignStatusFor(m, registry.id);
        }
        return ok(brand, rangeEcho(args.from, args.to), {
          campaign: {
            name: meta.campaign,
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
      description: `Daily series broken down by platform or campaign, gap-filled (no-data days appear as 0) like the dashboard "over time" chart. Each point carries spend, conversions, revenue, CPA, ROAS. ${CONVENTIONS}`,
      inputSchema: {
        brand: brandField,
        from: fromField,
        to: toField,
        dimension: z
          .enum(["platform", "campaign"])
          .default("platform")
          .describe("Break the series down by platform (default) or campaign."),
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
        "Returns a full diagnostic bundle for ONE campaign PLUS embedded instructions — the campaign's daily series and weekly history, every creative in it with cross-campaign context, this brand's same-platform benchmarks, the budget position, and the house conventions. FOLLOW THE EMBEDDED INSTRUCTIONS EXACTLY: interview the user for the data this system does not have (reach and frequency, explicitly) BEFORE concluding anything, then render the report as an artifact. This system does not diagnose — you do, from this bundle.",
      inputSchema: {
        brand: brandField,
        campaign: z
          .string()
          .describe("Exact campaign name, as returned by list_campaigns."),
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
            `No campaign named "${args.campaign}" in ${brand.name}. Call list_campaigns to get the exact names.`,
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
        "One month of Budget, exactly as the Budget Overview reads it: the plan against actual ad spend — the brand total, each platform and each planned objective bucket — with pacing, the month-end projection, the reserve (planned, used, remaining), the store-revenue target against actual revenue, orders, and ROAS (actual, target, projected). SPEND IS USD; REVENUE IS SAR (the store's currency); ROAS converts spend at the month's stored USD→SAR rate (`usd_to_sar_rate`). Pacing compares each platform through the days ITS data covers (not the calendar): `plan_to_date` is what the plan expected through that coverage and `deviation` = (actual − plan_to_date) ÷ plan_to_date (positive = ahead/overspending, negative = behind). Budget actuals are RAW totals — exclusions never apply here, by design. Revenue has no per-platform split in Budget. Viewing a month with no plan returns has_plan: false with the actuals only.",
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
        const [data, platformCoverage, storeHorizon, series] = await Promise.all([
          getBudgetMonth(month),
          platformHorizons(),
          storeDataHorizon(),
          budgetPacingSeries(monthStartIso(month), monthEndIso(month)),
        ]);
        // The same composition the Overview page runs — nothing re-derived here.
        const coverage = { ...platformCoverage, [REVENUE_COVERAGE_KEY]: storeHorizon };
        const t = buildTrackerRows(data, month, today, coverage);
        const coverageDay = makeCoverageDay(month, today, coverage);
        const roasActuals = monthRoasActuals({
          month,
          platformKeys: t.platforms.map((p) => p.key),
          coverageDay,
          spend: series.spend,
          days: series.days,
        });
        const roas = roasFigures({
          actualRevenueSar: roasActuals.revenueSar,
          actualSpendUsd: roasActuals.spendUsd,
          plannedRevenueSar: t.revenue.target,
          plannedSpendUsd: t.total.plan,
          targetRoas: data.planMode === "daily" ? data.targetRoas : null,
          projectedRevenueSar: t.projectedRevenue,
          projectedSpendUsd: t.projectedSpend,
          rate: data.usdToSarRate,
        });
        const bar = (b: TrackerBar) => ({
          plan: r2(b.plan),
          plan_to_date: r2(b.planToDate),
          actual: r2(b.actual),
          delta: r2(b.delta),
          deviation: b.deviation,
          verdict: pacingVerdict(b.deviation),
        });
        return ok(
          brand,
          rangeEcho(monthStartIso(month), monthEndIso(month)),
          {
            month,
            today,
            plan_mode: data.planMode,
            has_plan: t.hasPlan,
            usd_to_sar_rate: data.usdToSarRate,
            day_of_month: t.elapsedDays,
            days_in_month: t.totalDays,
            ads_data_through: latestCoverage(platformCoverage),
            ads_data_through_per_platform: platformCoverage,
            store_data_through: storeHorizon,
            spend_usd: {
              ...bar(t.total),
              projected_month_end: r2(t.projectedSpend),
              projected_pct_of_plan: t.projectedPctOfPlan,
            },
            platforms_usd: t.platforms.map((p) => ({
              platform: p.key,
              ...bar(p),
              buckets: p.buckets.map((b) => ({ objective: b.label, ...bar(b) })),
              unplanned: r2(p.unplanned),
              unplanned_buckets: p.unplannedBuckets.map((u) => ({
                objective: u.label,
                actual: r2(u.actual),
              })),
            })),
            unplanned_total_usd: r2(t.unplannedTotal),
            reserve_usd: {
              planned: r2(t.reserve),
              used: r2(t.reserveUsed),
              remaining: r2(t.reserveRemaining),
            },
            revenue_sar: {
              target: r2(t.revenue.target),
              ...bar(t.revenue),
              projected_month_end: r2(t.projectedRevenue),
            },
            orders: data.actualOrders,
            roas: {
              actual: r2(roas.actual),
              target: r2(roas.target),
              projected: r2(roas.projected),
              deviation: roas.deviation,
              // Revenue and spend both cut at this day of the month.
              through_day: roasActuals.throughDay,
            },
          },
        );
      }),
  );

  // 14 ─ get_store -----------------------------------------------------------
  server.registerTool(
    "get_store",
    {
      description:
        "The Store module for a range (defaults to the app's last 30 days): store orders and revenue — MONEY IS SAR here, never USD — per day and in total, split by the ad platform the order's UTM source maps to and by sales channel (website / application), plus Reconciliation: store orders against the conversions each ad platform CLAIMS, as COUNTS ONLY (Reconciliation never compares revenue). `delta` = claimed − store orders (positive = the platform over-claims); `delta_pct` and `match_rate` use store orders as the base and are null when the store recorded none. Orders whose source maps to no platform are `unattributed`. A brand that has never uploaded store orders returns zeros — call get_data_freshness / see `store_data_through` before reading a gap as a real zero.",
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
        const [daily, byPlatform, byChannel, overview, recon, storeHorizon] =
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
          ]);
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
      description: `Ad performance per landing page for a range (defaults to the app's last 30 days). An ad name ending in " @code" sends traffic to that registered landing page; a row with landing_page null is the PRODUCT's own page (no code). Each row is one (product, landing page), optionally split by platform. Pass \`code\` for ONE landing page in depth instead — what its detail page shows: totals, by platform, by campaign and by creative (all platforms, google included). ${CONVENTIONS}`,
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
              by_campaign: byCampaign.map((m) => ({
                campaign: m.campaign,
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
