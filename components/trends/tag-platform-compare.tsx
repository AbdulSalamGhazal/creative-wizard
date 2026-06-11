"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { int, pct, ratio, usd } from "@/lib/format";
import { ALL_PLATFORMS, PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import type { TagPlatformRow } from "@/db/queries/trends";

type MetricKey =
  | "spend" | "conversions" | "revenue" | "roas"
  | "cpa" | "cpm" | "ctr" | "cvr" | "hookRate";

interface MetricDef {
  key: MetricKey;
  label: string;
  fmt: (v: number) => string;
  lower?: boolean;
}

const METRICS: MetricDef[] = [
  { key: "spend", label: "Spend", fmt: usd },
  { key: "conversions", label: "Conversions", fmt: int },
  { key: "revenue", label: "Revenue", fmt: usd },
  { key: "roas", label: "ROAS", fmt: (v) => `${ratio(v)}×` },
  { key: "cpa", label: "CPA", fmt: usd, lower: true },
  { key: "cpm", label: "CPM", fmt: usd, lower: true },
  { key: "ctr", label: "CTR", fmt: (v) => pct(v) },
  { key: "cvr", label: "CvR", fmt: (v) => pct(v) },
  { key: "hookRate", label: "Hook", fmt: (v) => pct(v) },
];

const TOP_N = 5;
// Min–max scaling floor: the lowest-ranked bar in each platform still renders
// at this width so it stays visible (a true 0 would otherwise vanish).
const MIN_BAR = 10;

// Make the platform columns span the full width of the row whatever the count
// (4 for Urjwan, fewer for a brand on fewer channels). Static class strings so
// Tailwind keeps them in the build.
const LG_COLS: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
};

interface PlatformColumn {
  platform: (typeof ALL_PLATFORMS)[number];
  top: Array<{ tag: string; v: number }>;
  min: number;
  max: number;
}

/**
 * Build the per-platform top-N columns for one metric. Only platforms that
 * carry tagged data appear. `min`/`max` are over each platform's own displayed
 * tags so the bars can be min–max scaled within the column.
 */
function buildColumns(rows: TagPlatformRow[], metric: MetricDef): PlatformColumn[] {
  const byPlatform = new Map<string, TagPlatformRow[]>();
  for (const r of rows) {
    const list = byPlatform.get(r.platform) ?? [];
    list.push(r);
    byPlatform.set(r.platform, list);
  }
  return ALL_PLATFORMS.filter((p) => byPlatform.has(p)).map((p) => {
    const vals = byPlatform
      .get(p)!
      .map((r) => ({ tag: r.tag, v: r[metric.key] as number | null }))
      .filter((x): x is { tag: string; v: number } => x.v !== null);
    vals.sort((a, b) => (metric.lower ? a.v - b.v : b.v - a.v));
    const top = vals.slice(0, TOP_N);
    const nums = top.map((t) => t.v);
    return {
      platform: p,
      top,
      min: nums.length ? Math.min(...nums) : 0,
      max: nums.length ? Math.max(...nums) : 0,
    };
  });
}

/**
 * Min–max scale a value to a [MIN_BAR, 100] bar width. When every displayed
 * tag shares the same value (or there's only one) the spread is undefined, so
 * everything renders full — there's no relative difference to show.
 */
function barWidth(v: number, min: number, max: number): number {
  if (max <= min) return 100;
  return MIN_BAR + ((v - min) / (max - min)) * (100 - MIN_BAR);
}

/**
 * Platform comparison — the top tags within each channel, for one or more
 * chosen metrics. Each selected metric renders its own full-width row of
 * platform columns (Instagram vs Facebook vs TikTok vs Snapchat). Bars are
 * min–max scaled *within* each platform so tags whose absolute values sit very
 * close together still separate visually; the printed figure is always the
 * real value. A platform with no tagged data simply doesn't appear.
 */
export function TagPlatformCompare({ rows }: { rows: TagPlatformRow[] }) {
  const [selected, setSelected] = useState<MetricKey[]>(["spend"]);

  // Render rows in selection order so a newly-picked metric appends below.
  const selectedMetrics = useMemo(
    () =>
      selected
        .map((k) => METRICS.find((m) => m.key === k))
        .filter((m): m is MetricDef => Boolean(m)),
    [selected],
  );

  function toggle(key: MetricKey) {
    setSelected((cur) => {
      if (cur.includes(key)) {
        return cur.length === 1 ? cur : cur.filter((k) => k !== key);
      }
      return [...cur, key];
    });
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <h3 className="text-sm text-ink-2">Platform comparison</h3>
          <p className="text-[10px] text-ink-3">
            Top {TOP_N} tags within each platform · bars min–max scaled per
            platform · pick one or more metrics to stack rows
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {METRICS.map((m) => {
            const on = selected.includes(m.key);
            return (
              <button
                key={m.key}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(m.key)}
                className={cn(
                  "h-7 rounded-md border px-2.5 text-xs transition-colors focus:outline-none",
                  on
                    ? "border-brand/50 bg-brand/10 text-ink"
                    : "border-line bg-surface text-ink-3 hover:text-ink hover:border-brand/30",
                )}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-5">
        {selectedMetrics.map((metric) => (
          <MetricRow key={metric.key} rows={rows} metric={metric} />
        ))}
      </div>
    </div>
  );
}

function MetricRow({
  rows,
  metric,
}: {
  rows: TagPlatformRow[];
  metric: MetricDef;
}) {
  const columns = useMemo(() => buildColumns(rows, metric), [rows, metric]);
  const lgCols = LG_COLS[Math.min(columns.length, 5)] ?? "lg:grid-cols-4";

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-xs font-medium text-ink">{metric.label}</span>
        {metric.lower && (
          <span className="text-[10px] text-ink-3">lower is better</span>
        )}
      </div>

      {columns.length === 0 ? (
        <div className="h-20 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-lg">
          No tagged platform data in this window.
        </div>
      ) : (
        <div className={cn("grid grid-cols-1 sm:grid-cols-2 gap-3", lgCols)}>
          {columns.map((col) => (
            <div
              key={col.platform}
              className="rounded-md border border-line bg-surface-2/40 p-3.5"
            >
              <div className="flex items-center gap-1.5 mb-3">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ background: PLATFORM_COLOR[col.platform] }}
                />
                <span className="text-xs font-medium text-ink">
                  {PLATFORM_LABEL[col.platform]}
                </span>
              </div>
              {col.top.length === 0 ? (
                <div className="text-[11px] text-ink-3 py-2">
                  No {metric.label} here.
                </div>
              ) : (
                <div className="space-y-2">
                  {col.top.map((t, i) => {
                    const w = barWidth(t.v, col.min, col.max);
                    return (
                      <Link
                        key={t.tag}
                        href={`/creatives?tags=${encodeURIComponent(t.tag)}`}
                        className="group block"
                      >
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="inline-flex items-center gap-1 min-w-0">
                            <span className="text-ink-3 tabular-nums w-3">
                              {i + 1}
                            </span>
                            <span className="truncate text-ink group-hover:text-brand transition-colors">
                              {t.tag}
                            </span>
                          </span>
                          <span className="tabular-nums text-ink-2 shrink-0">
                            {metric.fmt(t.v)}
                          </span>
                        </div>
                        <div className="mt-1 h-2 rounded-full bg-surface overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${w}%`,
                              background: PLATFORM_COLOR[col.platform],
                              opacity: 0.7,
                            }}
                          />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
