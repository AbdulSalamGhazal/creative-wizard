import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  creativePoints,
  kpis,
  metricOverTime,
  productMix,
  tagMix,
  topCreatives,
  topMovers,
  typeDimensionSpend,
  type BreakdownDimension,
  type KpiFilters,
} from "@/db/queries/performance";
import {
  creativeStatusTransitions,
  type CreativeStatusTransitions,
} from "@/db/queries/creative-status";
import { getRatingConfig } from "@/db/queries/rating";
import {
  MetricOverTimeChart,
  type OverTimeKey,
} from "@/components/charts/metric-over-time";
import { TopCreativesTable } from "@/components/charts/top-creatives";
import { ProductMixDonut } from "@/components/charts/product-mix";
import { TypeMixBars } from "@/components/charts/type-mix-bars";
import { TagLeaderboard } from "@/components/charts/tag-leaderboard";
import { TopMoversChart } from "@/components/overview/top-movers-chart";
import { StatusFlow } from "@/components/overview/status-flow";
import { FunnelCard } from "@/components/overview/funnel-card";
import { RoasScatter } from "@/components/charts/roas-scatter";
import { RatingDistribution } from "@/components/overview/rating-distribution";
import { PLATFORM_COLOR, PLATFORM_LABEL, swatchColor } from "@/lib/palette";

const EMPTY_TRANSITIONS: CreativeStatusTransitions = {
  transitions: [],
  startCounts: { new: 0, active: 0, pause: 0, terminated: 0 },
  endCounts: { new: 0, active: 0, pause: 0, terminated: 0 },
  total: 0,
  untouchedNew: 0,
};

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
    statusTransitions,
    k,
    points,
    ratingConfig,
  ] = await Promise.all([
    metricOverTime(filters, dimension),
    topCreatives(filters, 10),
    productMix(filters),
    typeDimensionSpend(filters, dimension),
    tagMix(filters),
    hasRange
      ? topMovers(filters as KpiFilters & { from: string; to: string }, 12)
      : Promise.resolve([]),
    hasRange
      ? creativeStatusTransitions(filters.from!, filters.to!)
      : Promise.resolve(EMPTY_TRANSITIONS),
    kpis(filters),
    creativePoints(filters),
    getRatingConfig(),
  ]);

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

  // Type-mix rows: one per platform (Google dropped for now) — or top campaigns
  // when a platform is pinned — ordered by total spend. The chart adds the
  // emphasized "Overall" row and computes the per-type percentages itself.
  const typeData =
    dimension === "platform"
      ? typeRows.filter((r) => r.key !== "google")
      : typeRows;
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

      {/* Top movers + status flow */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TopMoversChart rows={moverRows} />
        <StatusFlow data={statusTransitions} />
      </div>

      {/* Funnel + spend-vs-ROAS scatter + rating distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <FunnelCard k={k} />
        <RoasScatter points={points.slice(0, 40)} />
        <RatingDistribution points={points} config={ratingConfig} />
      </div>

      {/* Top creatives */}
      <Card className="bg-surface border-line">
        <CardHeader>
          <CardTitle className="text-sm">Top creatives by spend</CardTitle>
        </CardHeader>
        <CardContent>
          <TopCreativesTable rows={topRows} />
        </CardContent>
      </Card>
    </section>
  );
}
