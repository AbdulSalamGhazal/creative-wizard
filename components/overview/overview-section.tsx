import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  metricOverTime,
  productMix,
  tagMix,
  topCreatives,
  typePlatformSpend,
  type BreakdownDimension,
  type KpiFilters,
} from "@/db/queries/performance";
import {
  MetricOverTimeChart,
  type OverTimeKey,
} from "@/components/charts/metric-over-time";
import { TopCreativesTable } from "@/components/charts/top-creatives";
import { ProductMixDonut } from "@/components/charts/product-mix";
import { TypeCompositionChart } from "@/components/charts/type-composition";
import { TagLeaderboard } from "@/components/charts/tag-leaderboard";
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
  const [otRows, topRows, productMixRows, typePlatformRows, tagMixRows] =
    await Promise.all([
      metricOverTime(filters, dimension),
      topCreatives(filters, 10),
      productMix(filters),
      typePlatformSpend(filters),
      tagMix(filters),
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
          <CardContent className="flex-1 flex items-center justify-center">
            <ProductMixDonut rows={productMixRows} />
          </CardContent>
        </Card>
        <TypeCompositionChart rows={typePlatformRows} />
        <TagLeaderboard rows={tagMixRows} />
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
