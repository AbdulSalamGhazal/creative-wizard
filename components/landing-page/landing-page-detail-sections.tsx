import { DollarSign, Target, Banknote, Receipt, TrendingUp } from "lucide-react";
import {
  campaignMix,
  creativeDailyMetrics,
  filteredPlatformFirstDays,
  kpisWithDelta,
  platformMix,
} from "@/db/queries/performance";
import { landingPageCreatives } from "@/db/queries/landing-pages";
import {
  earliestOf,
  latestOf,
  platformHorizons,
  resolveEntityBounds,
  resolvePlatformBounds,
} from "@/db/queries/series-bounds";
import { CreativePerfLineChart } from "@/components/charts/creative-perf-line";
import { CreativeCampaignsTable } from "@/components/creative/creative-campaigns-table";
import { CampaignCreativesTable } from "@/components/campaign/campaign-creatives-table";
import { MetricCard } from "@/components/overview/metric-card";
import { int, roas, usd, usd0 } from "@/lib/format";
import { computeDelta, deltaVsLabel } from "@/lib/period";
import { TABLE_KEYS } from "@/lib/table-columns";

/**
 * A landing page's STREAMED analytics (2026-11-12) — the creative page's body
 * (`CreativeAnalyticsBody`) scoped to the records whose ad name carried this
 * page's ` @code` (`KpiFilters.landingPageIds`), plus the creatives that sent
 * the traffic. Every figure is a component sum through the shared queries;
 * all platforms, like the creative page; the Excluded toggle applies.
 */
export async function LandingPageAnalyticsBody({
  landingPageId,
  range,
  includeExcluded,
}: {
  landingPageId: string;
  range: { from: string; to: string };
  includeExcluded: boolean;
}) {
  const scope = { landingPageIds: [landingPageId], ...range, includeExcluded };

  // Edge-fill bounds, as on the creative page: each platform's line trails to
  // its own horizon; the total leads from the page's first-ever day.
  const [pHorizons, pFirstDays] = await Promise.all([
    platformHorizons(),
    filteredPlatformFirstDays({ landingPageIds: [landingPageId], includeExcluded }),
  ]);
  const platformEdges = resolvePlatformBounds({
    from: range.from,
    to: range.to,
    firstDays: pFirstDays,
    horizons: pHorizons,
  });
  const groupBounds = resolveEntityBounds({
    from: range.from,
    to: range.to,
    firstEver: earliestOf(pFirstDays),
    horizon: latestOf(pHorizons),
  });

  const [kd, byPlatform, byCampaign, dailyRows, creativeRows] = await Promise.all([
    kpisWithDelta(scope),
    platformMix(scope),
    campaignMix(scope),
    creativeDailyMetrics(scope, platformEdges),
    landingPageCreatives(landingPageId, range, includeExcluded),
  ]);

  const k = kd.current;
  const d = kd.delta;
  const p = kd.previous;
  const revenueDelta = computeDelta(k.conversionValue, p.conversionValue);
  const vs = (previous: string) => deltaVsLabel(range.from, range.to, previous);

  return (
    <>
      <div className="grid grid-cols-2 @xl/main:grid-cols-3 @4xl/main:grid-cols-5 gap-3">
        <MetricCard label="Spend" value={usd0(k.spend)} icon={DollarSign} delta={d.spend} deltaVs={vs(usd0(p.spend))} hideBreakdown />
        <MetricCard label="Conversions" value={int(k.conversions)} icon={Target} delta={d.conversions} deltaVs={vs(int(p.conversions))} hideBreakdown />
        <MetricCard label="Revenue" value={usd0(k.conversionValue)} icon={Banknote} delta={revenueDelta} deltaVs={vs(usd0(p.conversionValue))} hideBreakdown />
        <MetricCard label="CPA" value={usd(k.cpa)} icon={Receipt} delta={d.cpa} deltaInverted deltaVs={vs(usd(p.cpa))} hideBreakdown />
        <MetricCard label="ROAS" value={roas(k.roas)} icon={TrendingUp} delta={d.roas} deltaVs={vs(roas(p.roas))} hideBreakdown />
      </div>

      <CreativePerfLineChart
        title="Performance over time"
        rows={dailyRows}
        fillFrom={groupBounds.fillFrom}
        fillTo={groupBounds.fillTo}
        subject="landing page"
      />

      <div>
        <h3 className="text-sm font-medium text-ink mb-3">Campaigns</h3>
        <CreativeCampaignsTable
          campaigns={byCampaign}
          platforms={byPlatform}
          subject="landing page"
        />
      </div>

      <div>
        <h3 className="text-sm font-medium text-ink mb-3">Creatives</h3>
        <CampaignCreativesTable
          creatives={creativeRows}
          tableKey={TABLE_KEYS.LANDING_PAGE_CREATIVES}
          seriesDots={false}
          emptyTitle="No creatives sent traffic here in this window."
          emptyButtons={false}
        />
      </div>
    </>
  );
}
