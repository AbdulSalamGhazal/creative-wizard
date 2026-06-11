import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  creativeDimensionPoints,
  creativeLeaderboard,
  creativeMetricRows,
  dailyFunnelRates,
  kpis,
  kpisWithDelta,
  metricOverTime,
  productMix,
  tagMix,
  topMovers,
  typeDimensionSpend,
  type BreakdownDimension,
  type KpiFilters,
  type KpisWithDelta,
} from "@/db/queries/performance";
import {
  statusFlowBreakdown,
  type StatusFlowScope,
} from "@/db/queries/creative-status";
import { getRatingConfig } from "@/db/queries/rating";
import { rateBlock, rulesForScope, type Rating } from "@/lib/rating";
import {
  MetricOverTimeChart,
  type OverTimeKey,
} from "@/components/charts/metric-over-time";
import { TopCreativesTable } from "@/components/charts/top-creatives";
import { ProductMixDonut } from "@/components/charts/product-mix";
import { TypeMixBars } from "@/components/charts/type-mix-bars";
import { TagLeaderboard } from "@/components/charts/tag-leaderboard";
import { TopMoversChart } from "@/components/overview/top-movers-chart";
import { StatusFlowGrid } from "@/components/overview/status-flow-grid";
import { FunnelRates } from "@/components/overview/funnel-rates";
import { CorrelationMatrix } from "@/components/charts/correlation-matrix";
import {
  RatingMixBars,
  type RatingRow,
} from "@/components/charts/rating-mix-bars";
import { PLATFORM_COLOR, PLATFORM_LABEL, swatchColor } from "@/lib/palette";


const CAMPAIGN_LINE_LIMIT = 6;

interface Props {
  /** Base filters from the URL (date / product / type / tag / excluded). */
  filters: KpiFilters;
  /** Over-time breakdown dimension: platform, or campaign when one platform
   *  is pinned. */
  dimension: BreakdownDimension;
  /** Pinned-platform name, shown beside "by campaign". */
  dimensionLabel?: string;
}

/**
 * The lower Dashboard block: a metric-over-time line chart (metric picker in
 * its header, broken down by platform — or campaign when pinned to one), a row
 * of three mix graphs (Product donut · Type composition · Tag leaderboard),
 * and the top-creatives table.
 */
export async function OverviewSection({ filters, dimension, dimensionLabel }: Props) {
  const hasRange = Boolean(filters.from && filters.to);
  const [
    otRows,
    topRows,
    productMixRows,
    typeRows,
    tagMixRows,
    moverRows,
    statusScopes,
    kd,
    ratingConfig,
    ratingDimRows,
    dailyRates,
    metricRows,
  ] = await Promise.all([
    metricOverTime(filters, dimension),
    creativeLeaderboard(filters),
    productMix(filters),
    typeDimensionSpend(filters, dimension),
    tagMix(filters),
    hasRange
      ? topMovers(filters as KpiFilters & { from: string; to: string }, 12)
      : Promise.resolve([]),
    hasRange
      ? statusFlowBreakdown(
          {
            from: filters.from!,
            to: filters.to!,
            productIds: filters.productIds,
            types: filters.types,
            tags: filters.tags,
          },
          dimension,
          dimension === "campaign" && filters.platforms?.length === 1
            ? filters.platforms[0]
            : undefined,
        )
      : Promise.resolve([] as StatusFlowScope[]),
    hasRange
      ? kpisWithDelta(filters as KpiFilters & { from: string; to: string })
      : Promise.resolve(null as KpisWithDelta | null),
    getRatingConfig(),
    creativeDimensionPoints(filters, dimension),
    dailyFunnelRates(filters),
    creativeMetricRows(filters),
  ]);
  const k = kd?.current ?? (await kpis(filters));

  // Order the over-time lines by total spend; cap campaign lines so the chart
  // stays legible. Platform lines are always all present platforms.
  const totals = new Map<string, number>();
  for (const r of otRows) totals.set(r.key, (totals.get(r.key) ?? 0) + r.spend);
  let orderedKeys = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  if (dimension === "campaign") orderedKeys = orderedKeys.slice(0, CAMPAIGN_LINE_LIMIT);
  const keySet = new Set(orderedKeys);

  const keys: OverTimeKey[] = orderedKeys.map((k) => ({
    key: k,
    label:
      dimension === "platform"
        ? PLATFORM_LABEL[k as keyof typeof PLATFORM_LABEL] ?? k
        : k,
    color:
      dimension === "platform"
        ? PLATFORM_COLOR[k as keyof typeof PLATFORM_COLOR] ?? "var(--ink-3)"
        : swatchColor(k),
  }));
  const otFiltered =
    dimension === "campaign" ? otRows.filter((r) => keySet.has(r.key)) : otRows;

  // Type-mix rows: one per platform — or top campaigns when a platform is
  // pinned — ordered by total spend. The chart adds the emphasized "Overall"
  // row and computes the per-type percentages itself.
  const typeData = typeRows;
  const typeTotals = new Map<string, number>();
  for (const r of typeData) typeTotals.set(r.key, (typeTotals.get(r.key) ?? 0) + r.spend);
  let typeKeyOrder = [...typeTotals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  if (dimension === "campaign") typeKeyOrder = typeKeyOrder.slice(0, CAMPAIGN_LINE_LIMIT);
  const typeSeries = typeKeyOrder.map((k) => ({
    key: k,
    label:
      dimension === "platform"
        ? PLATFORM_LABEL[k as keyof typeof PLATFORM_LABEL] ?? k
        : k,
  }));
  const typeOverallLabel =
    dimension === "campaign" ? dimensionLabel ?? "All campaigns" : "Overall";

  // Rating-mix rows: rate each (creative, dimension) block, then sum spend by
  // (dimension, rating). Platform blocks use that platform's rules; campaign
  // blocks use the default rules.
  const ratingAgg = new Map<string, number>();
  for (const row of ratingDimRows) {
    const rules =
      dimension === "platform"
        ? rulesForScope(ratingConfig, row.key)
        : ratingConfig.default;
    const rating = rateBlock({ spend: row.spend, roas: row.roas }, rules);
    const aggKey = `${rating}|${row.key}`;
    ratingAgg.set(aggKey, (ratingAgg.get(aggKey) ?? 0) + row.spend);
  }
  const ratingRows: RatingRow[] = [...ratingAgg.entries()].map(([aggKey, spend]) => {
    const sep = aggKey.indexOf("|");
    return {
      rating: aggKey.slice(0, sep) as Rating,
      key: aggKey.slice(sep + 1),
      spend,
    };
  });
  const ratingTotals = new Map<string, number>();
  for (const r of ratingRows) ratingTotals.set(r.key, (ratingTotals.get(r.key) ?? 0) + r.spend);
  let ratingKeyOrder = [...ratingTotals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  if (dimension === "campaign") ratingKeyOrder = ratingKeyOrder.slice(0, CAMPAIGN_LINE_LIMIT);
  const ratingSeries = ratingKeyOrder.map((k) => ({
    key: k,
    label:
      dimension === "platform"
        ? PLATFORM_LABEL[k as keyof typeof PLATFORM_LABEL] ?? k
        : k,
  }));

  return (
    <section className="space-y-4">
      {/* Metric over time */}
      <MetricOverTimeChart
        rows={otFiltered}
        keys={keys}
        dimension={dimension}
        dimensionLabel={dimensionLabel}
      />

      {/* Three mix graphs in one row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="bg-surface border-line h-full flex flex-col">
          <CardHeader>
            <CardTitle className="text-sm">Product mix</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col">
            <ProductMixDonut rows={productMixRows} />
          </CardContent>
        </Card>
        <TypeMixBars
          rows={typeData}
          series={typeSeries}
          overallLabel={typeOverallLabel}
          dimension={dimension}
          dimensionLabel={dimensionLabel}
        />
        <TagLeaderboard rows={tagMixRows} />
      </div>

      {/* Top movers + funnel rates (full row, half each) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TopMoversChart rows={moverRows} />
        <FunnelRates k={k} kd={kd} daily={dailyRates} />
      </div>

      {/* Status flow — four diagrams (per platform, or per top campaign when a
          single platform is filtered) */}
      <StatusFlowGrid scopes={statusScopes} dimension={dimension} />

      {/* Rating mix + per-creative correlation matrix (full row, half each) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RatingMixBars
          rows={ratingRows}
          series={ratingSeries}
          overallLabel={typeOverallLabel}
          dimension={dimension}
          dimensionLabel={dimensionLabel}
        />
        <CorrelationMatrix rows={metricRows} />
      </div>

      {/* Top creatives (title + ranking metric + column toggles live in the
          table's own toolbar) */}
      <Card className="bg-surface border-line">
        <CardContent>
          <TopCreativesTable rows={topRows} />
        </CardContent>
      </Card>
    </section>
  );
}
