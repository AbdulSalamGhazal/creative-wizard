"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Coins, Package, Percent, Target as TargetIcon, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { MetricCard } from "@/components/overview/metric-card";
import { evaluateAll, statusCounts } from "@/price-structure/engine/all-offers";
import { isMetricKey, METRICS, metricValue, rankCompare } from "@/price-structure/engine/metrics";
import { METRIC_KEYS, type MetricKey } from "@/price-structure/engine/types";
import { money0, pct2 } from "@/price-structure/format";
import { productColor, STATUS_META } from "../palette";
import { PsPageHeader } from "../ps-page-header";
import { RiyalBars, type RiyalRow } from "../riyal-bars";
import { SectionCard } from "../section-card";
import { useOpenVersion } from "../version-provider";
import { useViewPref } from "../view-prefs";
import { CompareOffersChart } from "./compare-offers-chart";
import { PriceStructureTable, type CostView } from "./price-structure-table";

type Grouping = "grouped" | "ranked";

/** Overview (brief §6.1): every offer's price structure, ranking and status against targets. */
export function OverviewView() {
  const version = useOpenVersion();
  const v = useSearchParams().get("v");
  const [grouping, setGrouping] = useViewPref<Grouping>("overview.grouping", "grouped", ["grouped", "ranked"]);
  const [costView, setCostView] = useViewPref<CostView>("overview.cost", "pct", ["pct", "sar"]);
  const [metricRaw, setMetric] = useViewPref<MetricKey>("overview.metric", "margin", METRIC_KEYS);
  const metric: MetricKey = isMetricKey(metricRaw) ? metricRaw : "margin";

  const data = version?.data;
  const evaluated = useMemo(() => (data ? evaluateAll(data) : null), [data]);
  const q = v ? `?v=${v}` : "";

  if (!version || !data || !evaluated) {
    return <PsPageHeader title="Overview" info={INTRO} />;
  }
  const { rows, enabledTargets } = evaluated;
  const monthlyPlaced = rows.reduce((s, r) => s + r.offer.ordersPerMonth, 0);
  const monthly = monthlyPlaced > 0;
  const chartMetric: MetricKey = !monthly && METRICS[metric].monthly ? "margin" : metric;

  const best = rows.length ? rows.reduce((a, b) => (b.r.margin > a.r.margin ? b : a)) : null;
  const worst = rows.length ? rows.reduce((a, b) => (b.r.margin < a.r.margin ? b : a)) : null;
  const counts = statusCounts(rows);
  const monthlyProfit = rows.reduce((s, r) => s + r.r.monthly.profit, 0);
  const monthlyRevenue = rows.reduce((s, r) => s + r.r.monthly.revenue, 0);
  const monthlyAds = rows.reduce((s, r) => s + r.r.monthly.adSpend, 0);
  const productCount = data.products.length;

  const riyalRows: RiyalRow[] = rows.map((row) => ({
    key: row.offer.id,
    label: row.offer.name,
    sublabel: row.product.name,
    color: productColor(row.product.colorSlot),
    netRevenue: row.r.netRevenue,
    parts: { cml: row.r.profit, cogs: row.r.cogs, marketing: row.r.marketing, undelivered: row.r.undelivered },
  }));

  // Two abreast on a phone or a tablet (the labels are long), four or six on a desktop.
  const tiles = `grid gap-3 grid-cols-2 ${monthly ? "@3xl/main:grid-cols-3 @6xl/main:grid-cols-6" : "@5xl/main:grid-cols-4"}`;

  return (
    <>
      <PsPageHeader title="Overview" info={INTRO} />
      {rows.length === 0 ? (
        <EmptyState
          title="No products yet"
          hint="Add a product and its offers to see what each one leaves after VAT, COGS and marketing."
          action={
            <Button asChild size="sm">
              <Link href={`/price-structure/products${q}`}>Add your first product</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className={tiles}>
            <MetricCard label="Offers analysed" value={String(rows.length)} icon={Package} hideBreakdown footer={`${productCount} product${productCount === 1 ? "" : "s"}`} />
            <MetricCard
              label="Best CML %"
              value={pct2(best?.r.margin)}
              icon={TrendingUp}
              hideBreakdown
              footer={best ? <span dir="auto">{best.product.name} · {best.offer.name}</span> : undefined}
            />
            <MetricCard
              label="Weakest CML %"
              value={pct2(worst?.r.margin)}
              icon={TrendingDown}
              hideBreakdown
              footer={worst ? <span dir="auto">{worst.product.name} · {worst.offer.name}</span> : undefined}
            />
            <MetricCard
              label="Against your targets"
              value={enabledTargets.length ? `${counts.b} · ${counts.a} · ${counts.miss}` : "—"}
              // One row, each count once with its word, in its status colour
              // (R-124: the glyph row and its legend said every count twice).
              figure={
                enabledTargets.length ? (
                  <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    {(
                      [
                        ["b", counts.b, "Hits B"],
                        ["a", counts.a, "Hits A"],
                        ["miss", counts.miss, "Misses A"],
                      ] as const
                    ).map(([k, n, word]) => (
                      <span key={k} className="inline-flex items-baseline gap-1 whitespace-nowrap">
                        <span className={`font-display text-[1.75rem] leading-none tabular-nums ${STATUS_META[k].text}`}>
                          {n}
                        </span>
                        <span className="text-xs text-ink-3">{word}</span>
                      </span>
                    ))}
                  </span>
                ) : undefined
              }
              icon={TargetIcon}
              hideBreakdown
              footer={
                <Link href={`/price-structure/targets${q}`} className="text-brand hover:underline">
                  {enabledTargets.length ? "Edit targets" : "Set target A and B"}
                </Link>
              }
            />
            {monthly && (
              <>
                <MetricCard label="Monthly CML" value={`${money0(monthlyProfit)} SAR`} icon={Coins} hideBreakdown footer={`${money0(monthlyPlaced)} orders placed / month`} />
                <MetricCard
                  label="Blended CML %"
                  value={pct2(monthlyRevenue > 0 ? monthlyProfit / monthlyRevenue : NaN)}
                  icon={Percent}
                  hideBreakdown
                  footer={`Revenue ${money0(monthlyRevenue)} · Ads ${money0(monthlyAds)} SAR`}
                />
              </>
            )}
          </div>
          <PriceStructureTable
            evaluated={evaluated}
            grouping={grouping}
            onGrouping={setGrouping}
            costView={costView}
            onCostView={setCostView}
            chartMetric={chartMetric}
          />
          <div className="grid gap-4 @5xl/main:grid-cols-2">
            <SectionCard title="Where each riyal goes" subtitle={costView === "pct" ? "Share of net revenue per offer" : "SAR per delivered order"}>
              <RiyalBars rows={grouping === "ranked" ? rankRows(riyalRows, evaluated, chartMetric) : riyalRows} mode={costView} />
            </SectionCard>
            <CompareOffersChart rows={rows} targets={data.targets} metric={chartMetric} onMetric={setMetric} monthly={monthly} />
          </div>
        </>
      )}
    </>
  );
}

const INTRO =
  "Every product and offer. Money is per delivered order, and percentages are of net revenue (after VAT and discounts are removed).";

/** The riyal bars follow the table's row order. */
function rankRows(rows: RiyalRow[], evaluated: ReturnType<typeof evaluateAll>, metric: MetricKey): RiyalRow[] {
  const byId = new Map(rows.map((r) => [r.key, r]));
  const cmp = rankCompare(metric);
  return [...evaluated.rows]
    .sort((a, b) => cmp(metricValue(a.r, metric), metricValue(b.r, metric)))
    .map((o) => byId.get(o.offer.id)!)
    .filter(Boolean);
}
