import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { defaultDateRange } from "@/db/queries/performance";
import {
  campaignFunnel,
  funnelDaily,
  funnelOverview,
} from "@/db/queries/funnel";
import { listProducts } from "@/db/queries/products";
import { listAllTags } from "@/db/queries/creatives";
import { FilterStrip } from "@/components/filters/filter-strip";
import { KpiTile } from "@/components/kpi/kpi-tile";
import { FunnelStages } from "@/components/funnel/funnel-stages";
import { FunnelTrendChart } from "@/components/funnel/funnel-trend-chart";
import { CampaignFunnelTable } from "@/components/funnel/campaign-funnel-table";
import { dashboardFiltersSchema } from "@/validators/filters";
import { periodCaption } from "@/lib/period";
import { pct, usd } from "@/lib/format";

export const dynamic = "force-dynamic";

const TRAILING_DAYS_DEFAULT = 30;

type SearchParams = Record<string, string | string[] | undefined>;
function pickFirst(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function FunnelPage({
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
    includeExcluded: pickFirst(params.includeExcluded),
  });

  const range = defaultDateRange(TRAILING_DAYS_DEFAULT);
  const from = parsed.from ?? range.from;
  const to = parsed.to ?? range.to;
  const filters = {
    from,
    to,
    platforms: parsed.platforms.length > 0 ? parsed.platforms : undefined,
    productIds: parsed.productIds.length > 0 ? parsed.productIds : undefined,
    includeExcluded: parsed.includeExcluded,
  };

  const [overview, campaigns, daily, products, tags] = await Promise.all([
    funnelOverview(filters),
    campaignFunnel(filters),
    funnelDaily(filters),
    listProducts(),
    listAllTags(),
  ]);

  const caption = periodCaption(from, to);
  const c = overview.current;

  return (
    <div className="space-y-6">
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
            Main metrics
          </div>
          <h1 className="font-display text-4xl tracking-tight">Funnel</h1>
          <p className="text-ink-2 text-sm mt-1">
            CPM, CTR, VOC, and CvR by campaign — the funnel from impression to
            conversion. Watch which rate is sliding to see exactly where a
            campaign is leaking.
          </p>
        </div>
        <Badge variant="outline" className="text-ink-3">
          {from} → {to}
        </Badge>
      </div>

      {/* Headline funnel rates (CPM lower = better, so its delta is inverted) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile
          label="CPM"
          value={usd(c.cpm)}
          delta={overview.deltas.cpm}
          inverted
          caption={`cost / 1k impressions · ${caption}`}
        />
        <KpiTile
          label="CTR"
          value={pct(c.ctr)}
          delta={overview.deltas.ctr}
          caption={`clicks / impressions · ${caption}`}
        />
        <KpiTile
          label="VOC"
          value={pct(c.voc)}
          delta={overview.deltas.voc}
          caption={`LP views / clicks · ${caption}`}
        />
        <KpiTile
          label="CvR"
          value={pct(c.cvr)}
          delta={overview.deltas.cvr}
          caption={`conversions / LP views · ${caption}`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <FunnelStages totals={c} />
        <FunnelTrendChart points={daily} />
      </div>

      <div className="space-y-2">
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
          By campaign · {campaigns.length} campaign{campaigns.length === 1 ? "" : "s"}
        </h2>
        <CampaignFunnelTable rows={campaigns} />
      </div>
    </div>
  );
}
