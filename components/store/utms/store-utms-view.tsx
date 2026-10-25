"use client";

import { useMemo } from "react";
import Link from "next/link";
import { CircleHelp, Coins, Megaphone, ShoppingBag } from "lucide-react";
import { MetricCard, type BreakdownBar } from "@/components/overview/metric-card";
import { DateRangePicker } from "@/components/filters/date-range-picker";
import { FilterShell } from "@/components/filters/filter-shell";
import { useFilterParams } from "@/components/filters/use-filter-params";
import { ExcludedParamToggle } from "@/components/filters/excluded-param-toggle";
import { EmptyState } from "@/components/ui/empty-state";
import type { DateRangeValue } from "@/lib/date-presets";
import { int, pct1, plural, sar } from "@/lib/format";
import { ALL_PLATFORMS, PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import {
  TOP_SOURCE_SERIES,
  share,
  utmBucketColor,
  utmCoverage,
  type UtmBucketDay,
  type UtmSourceRow,
} from "@/lib/store-utms";
import { NO_SOURCE, UNMAPPED_SOURCE } from "@/store/sources";
import type { UtmClaimedDay, UtmSourceDay } from "@/db/queries/store-utms";
import { UtmSourcesSection } from "./utm-sources-section";
import { UtmCompareSection } from "./utm-compare-section";
import { UtmAccuracySection } from "./utm-accuracy-section";
import { UtmHygieneSection } from "./utm-hygiene-section";

/**
 * Store → UTMs — the whole client surface, in reading order: how well orders
 * are tagged (coverage), where they come from (sources), whether the
 * platforms' numbers can be trusted (accuracy), a side-by-side tool
 * (compare), and what to fix (hygiene). Every number is a component sum over
 * the resolved range; nothing compares against an earlier window.
 */
export function StoreUtmsView({
  from,
  to,
  resolvedRange,
  includeExcluded,
  sourceFieldLabel,
  daily,
  breakdown,
  totalValues,
  sourceDaily,
  claimed,
  maxHorizon,
  canConfig,
}: {
  /** Raw URL range (drives the highlighted preset), null when absent. */
  from: string | null;
  to: string | null;
  /** What the scans actually ran — the picker's label falls back to it. */
  resolvedRange: DateRangeValue;
  /** Effective Excluded state for the ads side (URL → saved pref → hidden). */
  includeExcluded: boolean;
  /** The brand's label for the `utm_source` field — names the blank bucket. */
  sourceFieldLabel: string;
  daily: UtmBucketDay[];
  breakdown: UtmSourceRow[];
  /** Distinct source values in range before the query's group cap. */
  totalValues: number;
  /** Per-day series for the top sources (and the blank bucket). */
  sourceDaily: UtmSourceDay[];
  claimed: UtmClaimedDay[];
  /** Latest ads data day across platforms, for the attribution-lag note. */
  maxHorizon: string | null;
  canConfig: boolean;
}) {
  const { update } = useFilterParams();

  const coverage = useMemo(() => utmCoverage(daily), [daily]);
  const empty = coverage.orders === 0;
  const unknown = coverage.blank + coverage.unmapped;

  // Values in range that nobody has mapped — the banner's count; the hygiene
  // section lists them.
  const unmappedValues = useMemo(
    () => breakdown.filter((r) => r.bucket === UNMAPPED_SOURCE && r.value !== null).length,
    [breakdown],
  );

  // The ads tile's bars: one per platform with orders, as a share of ALL
  // orders so the bars visually sum to the headline percentage.
  const adsBars = useMemo((): BreakdownBar[] => {
    if (coverage.orders === 0) return [];
    return ALL_PLATFORMS.filter((p) => coverage.byPlatform[p] > 0).map((p) => ({
      key: p,
      label: PLATFORM_LABEL[p],
      color: PLATFORM_COLOR[p],
      fraction: coverage.byPlatform[p] / coverage.orders,
      display: int(coverage.byPlatform[p]),
    }));
  }, [coverage]);

  const unknownBars = useMemo((): BreakdownBar[] => {
    if (coverage.orders === 0) return [];
    const bars: BreakdownBar[] = [];
    if (coverage.blank > 0) {
      bars.push({
        key: "blank",
        label: "No UTM",
        color: utmBucketColor(NO_SOURCE),
        fraction: coverage.blank / coverage.orders,
        display: int(coverage.blank),
      });
    }
    if (coverage.unmapped > 0) {
      bars.push({
        key: "unmapped",
        label: "Unmapped",
        color: utmBucketColor(UNMAPPED_SOURCE),
        fraction: coverage.unmapped / coverage.orders,
        display: int(coverage.unmapped),
      });
    }
    return bars;
  }, [coverage]);

  const topRows = useMemo(() => breakdown.slice(0, TOP_SOURCE_SERIES), [breakdown]);

  return (
    <div className="space-y-6">
      {/* A ZERO-DEF bar: the range is the only filter; the Excluded toggle is
          a data-scope switch for the ads side (accuracy), not a filter. */}
      <FilterShell
        filters={[]}
        tier1={({ fullWidth }) => (
          <DateRangePicker
            from={from}
            to={to}
            onChange={(nf, nt) =>
              update((p) => {
                if (nf) p.set("from", nf);
                else p.delete("from");
                if (nt) p.set("to", nt);
                else p.delete("to");
              })
            }
            remember
            fullWidth={fullWidth}
            fallback={resolvedRange}
          />
        )}
        toolbar={() => <ExcludedParamToggle on={includeExcluded} />}
      />

      {/* Coverage — the range only. ads + other + unknown = orders. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Orders"
          value={empty ? "—" : int(coverage.orders)}
          icon={ShoppingBag}
          hideBreakdown
          empty={empty}
          footer={empty ? undefined : <span>{sar(coverage.revenue)}</span>}
        />
        <MetricCard
          label="From ads"
          value={empty ? "—" : pct1(share(coverage.ads, coverage.orders))}
          icon={Megaphone}
          bars={adsBars}
          emptyText="No order carries a mapped ad source."
          hideBreakdown={empty}
          empty={empty}
        />
        <MetricCard
          label="Other sources"
          value={empty ? "—" : pct1(share(coverage.other, coverage.orders))}
          icon={Coins}
          hideBreakdown
          empty={empty}
          footer={empty ? undefined : <span>{plural(coverage.other, "order")}</span>}
        />
        <MetricCard
          label="Unknown"
          value={empty ? "—" : pct1(share(unknown, coverage.orders))}
          icon={CircleHelp}
          bars={unknownBars}
          emptyText="Every order has a mapped source."
          hideBreakdown={empty}
          empty={empty}
        />
      </div>

      {unmappedValues > 0 && (
        <div className="rounded-md border border-warn/30 bg-warn/[0.06] px-3 py-2 text-xs text-ink-2">
          {int(unmappedValues)} source value{unmappedValues === 1 ? "" : "s"} in range{" "}
          {unmappedValues === 1 ? "is" : "are"} unmapped — {plural(coverage.unmapped, "order")}{" "}
          count{coverage.unmapped === 1 ? "s" : ""} as Unknown.{" "}
          <Link href="#hygiene" className="underline hover:text-ink">
            {canConfig ? "Map them" : "See them"}
          </Link>
        </div>
      )}

      {empty ? (
        <EmptyState title="No orders in this range." kind="range" />
      ) : (
        <>
          <UtmSourcesSection
            daily={daily}
            breakdown={breakdown}
            totalValues={totalValues}
            sourceDaily={sourceDaily}
            range={resolvedRange}
            coverage={coverage}
            sourceFieldLabel={sourceFieldLabel}
          />
        </>
      )}

      <UtmAccuracySection
        daily={daily}
        claimed={claimed}
        range={resolvedRange}
        maxHorizon={maxHorizon}
      />

      {!empty && (
        <>
          <UtmCompareSection
            rows={topRows}
            sourceDaily={sourceDaily}
            range={resolvedRange}
            totalOrders={coverage.orders}
            sourceFieldLabel={sourceFieldLabel}
          />
          <UtmHygieneSection
            breakdown={breakdown}
            totalOrders={coverage.orders}
            canConfig={canConfig}
          />
        </>
      )}
    </div>
  );
}
