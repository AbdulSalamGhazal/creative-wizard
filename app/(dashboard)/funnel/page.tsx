import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { defaultDateRange } from "@/lib/date-presets";
import { resolvePreferredRange } from "@/db/queries/user-prefs";
import {
  campaignFunnel,
  funnelDaily,
  funnelOverview,
  platformFunnel,
  platformCampaignFunnel,
} from "@/db/queries/funnel";
import { listProducts } from "@/db/queries/products";
import { listAllTags } from "@/db/queries/creatives";
import { FilterStrip } from "@/components/filters/filter-strip";
import { FunnelRateTiles } from "@/components/funnel/funnel-rate-tiles";
import { FunnelStages } from "@/components/funnel/funnel-stages";
import { FunnelTrendChart } from "@/components/funnel/funnel-trend-chart";
import { PlatformFunnelComparison } from "@/components/funnel/platform-funnel-comparison";
import { CampaignFunnelTable } from "@/components/funnel/campaign-funnel-table";
import { dashboardFiltersSchema } from "@/validators/filters";
import { prevPeriod } from "@/lib/period";

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

  const range = await resolvePreferredRange(
    pickFirst(params.from),
    pickFirst(params.to),
    defaultDateRange(TRAILING_DAYS_DEFAULT),
  );
  const from = range.from;
  const to = range.to;
  const filters = {
    from,
    to,
    platforms: parsed.platforms.length > 0 ? parsed.platforms : undefined,
    productIds: parsed.productIds.length > 0 ? parsed.productIds : undefined,
    includeExcluded: parsed.includeExcluded,
  };

  const prev = prevPeriod(from, to);
  const [
    overview,
    campaigns,
    daily,
    dailyPrev,
    byPlatform,
    byPlatformCampaign,
    products,
    tags,
  ] = await Promise.all([
    funnelOverview(filters),
    campaignFunnel(filters),
    funnelDaily(filters),
    funnelDaily({ ...filters, from: prev.from, to: prev.to }),
    platformFunnel(filters),
    platformCampaignFunnel(filters),
    listProducts(),
    listAllTags(),
  ]);

  return (
    <PageShell
      filterStrip={
        <FilterStrip
          products={products}
          tags={tags}
          defaultFrom={from}
          defaultTo={to}
        />
      }
    >
      <PageHeader
        eyebrow="Main metrics"
        title="Funnel"
        rightSlot={
          <Badge variant="outline" className="text-ink-3">
            {from} → {to}
          </Badge>
        }
      />

      {/* Headline funnel rates in one row — dashboard "Funnel rates" style */}
      <FunnelRateTiles overview={overview} daily={daily} />

      <FunnelTrendChart points={daily} prevPoints={dailyPrev} />
      <FunnelStages totals={overview.current} compareTotals={overview.previous} />

      {/* Platform-vs-platform comparison */}
      <div className="space-y-2">
        <div>
          <h2 className="text-label text-ink-3">
            Platform comparison · {byPlatform.length} platform
            {byPlatform.length === 1 ? "" : "s"}
          </h2>
          <p className="text-[11px] text-ink-3">
            Green marks the leader per rate (lowest CPM, highest conversion
            rates). Click a platform to expand its campaign breakdown.
          </p>
        </div>
        <PlatformFunnelComparison
          platforms={byPlatform}
          campaigns={byPlatformCampaign}
        />
      </div>

      <div className="space-y-2">
        <h2 className="text-label text-ink-3">
          By campaign · {campaigns.length} campaign{campaigns.length === 1 ? "" : "s"}
        </h2>
        <CampaignFunnelTable rows={campaigns} />
      </div>
    </PageShell>
  );
}
