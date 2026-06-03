import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import {
  campaignByPlatform,
  campaignPortfolio,
  listCampaigns,
  type CampaignFilters,
} from "@/db/queries/campaign";
import { listProducts } from "@/db/queries/products";
import { listAllTags } from "@/db/queries/creatives";
import { FilterStrip } from "@/components/filters/filter-strip";
import { KpiTile } from "@/components/kpi/kpi-tile";
import { CampaignWinners } from "@/components/campaign/campaign-winners";
import { CampaignScatter } from "@/components/campaign/campaign-scatter";
import { CampaignRankBars } from "@/components/campaign/campaign-rank-bars";
import { CampaignTable } from "@/components/campaign/campaign-table";
import { dashboardFiltersSchema } from "@/validators/filters";
import { int, pct, ratio, usd } from "@/lib/format";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
function pickFirst(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const parsed = dashboardFiltersSchema.parse({
    from: pickFirst(params.from),
    to: pickFirst(params.to),
    productIds: pickFirst(params.productIds),
    platforms: pickFirst(params.platforms),
    types: pickFirst(params.types),
    statuses: pickFirst(params.statuses),
    tags: pickFirst(params.tags),
    includeExcluded: pickFirst(params.includeExcluded),
  });

  const filters: CampaignFilters = {
    from: parsed.from,
    to: parsed.to,
    platforms: parsed.platforms.length > 0 ? parsed.platforms : undefined,
    productIds: parsed.productIds.length > 0 ? parsed.productIds : undefined,
    types: parsed.types.length > 0 ? parsed.types : undefined,
    statuses: parsed.statuses.length > 0 ? parsed.statuses : undefined,
    tags: parsed.tags.length > 0 ? parsed.tags : undefined,
    includeExcluded: parsed.includeExcluded,
  };

  const [portfolio, grain, campaigns, products, tags] = await Promise.all([
    campaignPortfolio(filters),
    campaignByPlatform(filters),
    listCampaigns(filters),
    listProducts(),
    listAllTags(),
  ]);

  const rangeLabel =
    parsed.from && parsed.to ? `${parsed.from} → ${parsed.to}` : "All-time";

  const tiles = [
    { label: "Campaigns", value: int(portfolio.campaigns) },
    { label: "Spend", value: usd(portfolio.spend) },
    { label: "Conversions", value: int(portfolio.conversions) },
    { label: "Blended ROAS", value: ratio(portfolio.roas) },
    { label: "Blended CvR", value: pct(portfolio.cvr) },
    { label: "Blended CTR", value: pct(portfolio.ctr) },
  ];

  return (
    <div className="space-y-8">
      <Suspense
        fallback={<div className="-mx-6 px-6 h-12 border-b border-line bg-background/95" />}
      >
        <div className="-mx-6 -mt-6 mb-2">
          <FilterStrip products={products} tags={tags} />
        </div>
      </Suspense>

      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-ink-3 mb-1">
            Campaigns
          </div>
          <h1 className="font-display text-4xl tracking-tight">Campaign analysis</h1>
          <p className="text-ink-2 text-sm mt-1">
            Compare every campaign across the portfolio — who wins on each
            platform, where the money returns, and the full ranked list.
          </p>
        </div>
        <Badge variant="outline" className="text-ink-3">
          {rangeLabel} · {portfolio.campaigns} campaign{portfolio.campaigns === 1 ? "" : "s"} ·{" "}
          {portfolio.platforms} platform{portfolio.platforms === 1 ? "" : "s"}
        </Badge>
      </div>

      {/* Portfolio KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {tiles.map((t) => (
          <KpiTile key={t.label} label={t.label} value={t.value} />
        ))}
      </div>

      {/* Winners within platform */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium text-ink">Winners by platform</h2>
          <p className="text-[11px] text-ink-3">
            The strongest campaigns on each channel — ranked by ROAS (real
            performers with conversions), else by spend.
          </p>
        </div>
        <CampaignWinners rows={grain} />
      </section>

      {/* Compare — efficiency scatter */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-ink">Compare</h2>
        <CampaignScatter rows={grain} />
      </section>

      {/* Leaderboard bars */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-ink">Leaderboard</h2>
        <CampaignRankBars rows={grain} />
      </section>

      {/* Full table at the end */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-ink">All campaigns</h2>
        <CampaignTable rows={campaigns} />
      </section>
    </div>
  );
}
