"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { int, pct, roas, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MetricPicker } from "@/components/charts/metric-picker";
import type { TagRollupRow } from "@/db/queries/trends";

type MetricKey =
  | "spend" | "conversions" | "revenue" | "roas"
  | "cpa" | "cpm" | "ctr" | "cvr" | "hookRate";

interface MetricDef {
  key: MetricKey;
  label: string;
  fmt: (v: number) => string;
  lower?: boolean; // lower is better (CPA, CPM)
}

const METRICS: MetricDef[] = [
  { key: "spend", label: "Spend", fmt: usd },
  { key: "conversions", label: "Conversions", fmt: int },
  { key: "revenue", label: "Revenue", fmt: usd },
  { key: "roas", label: "ROAS", fmt: (v) => roas(v) },
  { key: "cpa", label: "CPA", fmt: usd, lower: true },
  { key: "cpm", label: "CPM", fmt: usd, lower: true },
  { key: "ctr", label: "CTR", fmt: (v) => pct(v) },
  { key: "cvr", label: "CvR", fmt: (v) => pct(v) },
  { key: "hookRate", label: "Hook", fmt: (v) => pct(v) },
];

const TOP_N = 10;

/**
 * Ranked tag leaderboard for a selectable metric. Bars are proportional to
 * magnitude; the ranking respects metric direction (CPA/CPM rank lowest-first).
 * Each tag links to the filtered Library.
 */
export function TagLeaderboard({ rows }: { rows: TagRollupRow[] }) {
  const [metricKey, setMetricKey] = useState<MetricKey>("spend");
  const metric = METRICS.find((m) => m.key === metricKey)!;

  const ranked = useMemo(() => {
    const withVal = rows
      .map((r) => ({ tag: r.tag, creatives: r.creatives, value: r[metricKey] as number | null }))
      .filter((r) => r.value !== null && (metric.lower ? r.value > 0 : r.value >= 0));
    withVal.sort((a, b) =>
      metric.lower ? (a.value as number) - (b.value as number) : (b.value as number) - (a.value as number),
    );
    const top = withVal.slice(0, TOP_N);
    const max = Math.max(...top.map((r) => Math.abs(r.value as number)), 1);
    return { top, max };
  }, [rows, metricKey, metric.lower]);

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div>
          <h3 className="text-sm text-ink-2">
            Top tags by {metric.label}
            {metric.lower && <span className="text-ink-3"> · lower is better</span>}
          </h3>
          <p className="text-[10px] text-ink-3">Ranked across all tags in this window</p>
        </div>
        <MetricPicker
          options={METRICS.map((m) => ({ value: m.key, label: m.label }))}
          value={metricKey}
          onChange={setMetricKey}
        />
      </div>

      {ranked.top.length === 0 ? (
        <div className="h-72 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-lg">
          No tags with {metric.label} in this window.
        </div>
      ) : (
        <div className="space-y-1.5">
          {ranked.top.map((r, i) => {
            const w = Math.max((Math.abs(r.value as number) / ranked.max) * 100, 2);
            return (
              <Link
                key={r.tag}
                href={`/creatives?tags=${encodeURIComponent(r.tag)}`}
                className="group flex items-center gap-2 text-xs"
              >
                <span className="w-4 text-right text-ink-3 tabular-nums">{i + 1}</span>
                <span className="w-32 shrink-0 truncate text-ink group-hover:text-brand transition-colors">
                  #{r.tag}
                </span>
                <div className="flex-1 h-4 rounded bg-surface-2 overflow-hidden">
                  <div
                    className={cn("h-full rounded", metric.lower ? "bg-warn/60" : "bg-brand/70")}
                    style={{ width: `${w}%` }}
                  />
                </div>
                <span className="w-24 text-right tabular-nums text-ink">
                  {metric.fmt(r.value as number)}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
