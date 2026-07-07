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
  type CreativeDimensionPoint,
  type KpiFilters,
  type KpisWithDelta,
} from "@/db/queries/performance";
import {
  statusFlowBreakdown,
  type StatusFlowScope,
} from "@/db/queries/creative-status";
import { getRatingConfig } from "@/db/queries/rating";
import {
  rateBlock,
  rulesForScope,
  type Rating,
  type RatingWindow,
} from "@/lib/rating";
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
  /** Explicit URL date range (raw, not resolved) — carried into creative
   *  links so the detail page opens on the same window. */
  rangeFrom?: string;
  rangeTo?: string;
}

/** Subtract whole days from an ISO YYYY-MM-DD date (UTC). */
function isoMinusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * The lower Dashboard block: a metric-over-time line chart (metric picker in
 * its header, broken down by platform — or campaign when pinned to one), a row
 * of three mix graphs (Product donut · Type composition · Tag leaderboard),
 * and the top-creatives table.
 */
export async function OverviewSection({
  filters,
  dimension,
  dimensionLabel,
  rangeFrom,
  rangeTo,
}: Props) {
  const hasRange = Boolean(filters.from && filters.to);

  // Rating lookback: judge each creative over a wider window than the displayed
  // range so a tight range doesn't read all-N/A. We compute ALL windows up
  // front so the in-card switch is instant (no navigation / page reload). A
  // window widens the range START only; `null` lookback = lifetime (no lower
  // bound), and the `none` window reuses the selected-range blocks themselves.
  const windowFilters = (lookbackDays: number | null): KpiFilters => ({
    ...filters,
    from:
      lookbackDays === null
        ? undefined
        : filters.from
          ? isoMinusDays(filters.from, lookbackDays)
          : undefined,
  });

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
    rows7d,
    rows30d,
    rowsLife,
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
    creativeDimensionPoints(windowFilters(7), dimension),
    creativeDimensionPoints(windowFilters(30), dimension),
    creativeDimensionPoints(windowFilters(null), dimension),
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

  // Rating-mix rows: bucket each (creative, dimension) block's SELECTED-range
  // spend by its rating — where the rating is judged over the chosen lookback
  // window so a tight range doesn't read all-N/A. Platform blocks use that
  // platform's rules; campaign blocks use the default rules. Computed for every
  // window so the in-card picker switches client-side with no reload.
  const ratingRowsFor = (windowRows: CreativeDimensionPoint[]): RatingRow[] => {
    const byBlock = new Map<string, { spend: number; roas: number | null }>();
    for (const r of windowRows) {
      byBlock.set(`${r.creativeId}|${r.key}`, { spend: r.spend, roas: r.roas });
    }
    const agg = new Map<string, number>();
    for (const row of ratingDimRows) {
      const rules =
        dimension === "platform"
          ? rulesForScope(ratingConfig, row.key)
          : ratingConfig.default;
      const judged =
        byBlock.get(`${row.creativeId}|${row.key}`) ??
        { spend: row.spend, roas: row.roas };
      const rating = rateBlock(judged, rules);
      const aggKey = `${rating}|${row.key}`;
      agg.set(aggKey, (agg.get(aggKey) ?? 0) + row.spend);
    }
    return [...agg.entries()].map(([aggKey, spend]) => {
      const sep = aggKey.indexOf("|");
      return {
        rating: aggKey.slice(0, sep) as Rating,
        key: aggKey.slice(sep + 1),
        spend,
      };
    });
  };
  const ratingRowsByWindow: Record<RatingWindow, RatingRow[]> = {
    "7d": ratingRowsFor(rows7d),
    "30d": ratingRowsFor(rows30d),
    life: ratingRowsFor(rowsLife),
    none: ratingRowsFor(ratingDimRows),
  };

  // Key order is window-independent (the displayed per-key spend is the
  // selected-range spend regardless of which window rated it).
  const ratingTotals = new Map<string, number>();
  for (const r of ratingDimRows) ratingTotals.set(r.key, (ratingTotals.get(r.key) ?? 0) + r.spend);
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
        <Card className="h-full flex flex-col">
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
        <TopMoversChart rows={moverRows} from={rangeFrom} to={rangeTo} />
        <FunnelRates k={k} kd={kd} daily={dailyRates} />
      </div>

      {/* Status flow — four diagrams (per platform, or per top campaign when a
          single platform is filtered) */}
      <StatusFlowGrid scopes={statusScopes} dimension={dimension} />

      {/* Rating mix + per-creative correlation matrix (full row, half each) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RatingMixBars
          rowsByWindow={ratingRowsByWindow}
          series={ratingSeries}
          overallLabel={typeOverallLabel}
          dimension={dimension}
          dimensionLabel={dimensionLabel}
        />
        <CorrelationMatrix rows={metricRows} />
      </div>

      {/* Top creatives (title + ranking metric + column toggles live in the
          table's own toolbar) */}
      <Card>
        <CardContent>
          <TopCreativesTable rows={topRows} />
        </CardContent>
      </Card>
    </section>
  );
}
