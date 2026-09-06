import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { platformEnum, creativeTypeEnum } from "@/db/schema";
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
import {
  currentActor,
  withBrand,
  ok,
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
  "Money is USD. Dates are YYYY-MM-DD. Blended metrics (CTR, ROAS, CPA, CvR, VOC, CPM) are weighted from component sums, never averaged.";

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
  .describe("Restrict to these platforms (instagram, facebook, tiktok, snapchat).");
const typesField = z
  .array(z.enum(creativeTypeEnum))
  .optional()
  .describe("Restrict to these creative types (video, image, slides).");
const productIdsField = z
  .array(z.string())
  .optional()
  .describe("Restrict to these product ids.");
const anglesField = z.array(z.string()).optional().describe("Restrict to these angles.");

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
        });
      }),
  );

  // 3 ─ list_creatives -------------------------------------------------------
  server.registerTool(
    "list_creatives",
    {
      description: `List creatives (the Library) with derived status, priority (1-3, null = unrated), angles, and 7d/30d spend. Filterable by status, type, product, angles, and search. Capped at 500 rows (\`truncated\` flag). ${CONVENTIONS} ${ANGLES_RENAME}`,
      inputSchema: {
        brand: brandField,
        status: z
          .array(z.enum(["new", "active", "pause", "terminated"]))
          .optional()
          .describe("Restrict to these derived statuses."),
        types: typesField,
        productIds: productIdsField,
        angles: anglesField,
        q: z.string().optional().describe("Search name/notes/angles (substring)."),
        platforms: platformsField,
      },
    },
    async (args) =>
      withBrand(args.brand, async (brand) => {
        const filters: CreativeListFilters = {
          statuses: args.status,
          types: args.types,
          productIds: args.productIds,
          angles: args.angles,
          q: args.q,
          platforms: args.platforms,
          sort: "spend-desc",
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
            angles: c.angles,
            spend7d: r2(c.spend7d),
            spend30d: r2(c.spend30d),
            launchDate: c.launchDate,
          })),
        });
      }),
  );

  // 4 ─ get_creative ---------------------------------------------------------
  server.registerTool(
    "get_creative",
    {
      description: `One creative in depth: fields, angles, per-platform status, and its per-campaign performance breakdown (all-time unless a range is given). ${CONVENTIONS} ${ANGLES_RENAME}`,
      inputSchema: {
        brand: brandField,
        name: z.string().describe("Exact creative name."),
        from: fromField,
        to: toField,
      },
    },
    async (args) =>
      withBrand(args.brand, async (brand) => {
        const creative = await getCreativeByName(args.name);
        if (!creative) throw new McpToolError(`No creative named "${args.name}".`);
        const [mix, statusMap] = await Promise.all([
          campaignMix({ creativeIds: [creative.id], from: args.from, to: args.to }),
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
        });
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
      },
    },
    async (args) =>
      withBrand(args.brand, async (brand) => {
        const range = defaultRange(args.from, args.to);
        const filters: PortfolioFilters = {
          from: range.from,
          to: range.to,
          platforms: args.platforms,
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
        });
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
      },
    },
    async (args) =>
      withBrand(args.brand, async (brand) => {
        const meta = await campaignMeta(args.name);
        if (!meta) throw new McpToolError(`No campaign named "${args.name}".`);
        const range = { from: args.from, to: args.to };
        const [analytics, daily, registry] = await Promise.all([
          campaignAnalytics(args.name, range),
          campaignDailyByCreative(args.name, range),
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
        });
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
        });
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
      },
    },
    async (args) =>
      withBrand(args.brand, async (brand) => {
        const filters: KpiFilters = {
          from: args.from,
          to: args.to,
          platforms: args.platforms,
          productIds: args.productIds,
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
        });
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
      },
    },
    async (args) =>
      withBrand(args.brand, async (brand) => {
        const overview = await funnelOverview({
          from: args.from,
          to: args.to,
          platforms: args.platforms,
          productIds: args.productIds,
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
        });
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
}

/** Campaign/portfolio tools require a bounded range; default to last 30 days. */
function defaultRange(from?: string, to?: string): { from: string; to: string } {
  if (from && to) return { from, to };
  const end = to ?? isoToday();
  const start = from ?? isoDaysBefore(end, 30);
  return { from: start, to: end };
}
function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}
function isoDaysBefore(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
