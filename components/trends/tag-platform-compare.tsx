"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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

/**
 * Platform comparison — the top tags within each channel for a chosen metric.
 * One selector drives every platform column, so you can see at a glance which
 * tags win on Instagram vs Facebook vs TikTok, etc. A platform with no tagged
 * data simply doesn't appear.
 */
export function TagPlatformCompare({ rows }: { rows: TagPlatformRow[] }) {
  const [metricKey, setMetricKey] = useState<MetricKey>("spend");
  const metric = METRICS.find((m) => m.key === metricKey)!;

  const columns = useMemo(() => {
    const byPlatform = new Map<string, TagPlatformRow[]>();
    for (const r of rows) {
      const list = byPlatform.get(r.platform) ?? [];
      list.push(r);
      byPlatform.set(r.platform, list);
    }
    return ALL_PLATFORMS.filter((p) => byPlatform.has(p)).map((p) => {
      const vals = byPlatform
        .get(p)!
        .map((r) => ({ tag: r.tag, v: r[metricKey] as number | null }))
        .filter((x): x is { tag: string; v: number } => x.v !== null);
      vals.sort((a, b) => (metric.lower ? a.v - b.v : b.v - a.v));
      const top = vals.slice(0, TOP_N);
      const max = Math.max(...top.map((t) => Math.abs(t.v)), 1);
      return { platform: p, top, max };
    });
  }, [rows, metricKey, metric.lower]);

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
        <div>
          <h3 className="text-sm text-ink-2">Platform comparison</h3>
          <p className="text-[10px] text-ink-3">
            Top {TOP_N} tags by {metric.label} within each platform
            {metric.lower && " · lower is better"}
          </p>
        </div>
        <select
          value={metricKey}
          onChange={(e) => setMetricKey(e.target.value as MetricKey)}
          className="h-7 rounded-md border border-line bg-surface text-xs text-ink px-2 focus:outline-none focus:border-brand/50"
        >
          {METRICS.map((m) => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </select>
      </div>

      {columns.length === 0 ? (
        <div className="h-24 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-lg">
          No tagged platform data in this window.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-3">
          {columns.map((col) => (
            <div key={col.platform} className="rounded-md border border-line bg-surface-2/40 p-3">
              <div className="flex items-center gap-1.5 mb-2.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: PLATFORM_COLOR[col.platform] }} />
                <span className="text-xs font-medium text-ink">{PLATFORM_LABEL[col.platform]}</span>
              </div>
              {col.top.length === 0 ? (
                <div className="text-[11px] text-ink-3 py-2">No {metric.label} here.</div>
              ) : (
                <div className="space-y-1.5">
                  {col.top.map((t, i) => {
                    const w = Math.max((Math.abs(t.v) / col.max) * 100, 3);
                    return (
                      <Link
                        key={t.tag}
                        href={`/creatives?tags=${encodeURIComponent(t.tag)}`}
                        className="group block"
                      >
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="inline-flex items-center gap-1 min-w-0">
                            <span className="text-ink-3 tabular-nums w-3">{i + 1}</span>
                            <span className="truncate text-ink group-hover:text-brand transition-colors">
                              {t.tag}
                            </span>
                          </span>
                          <span className="tabular-nums text-ink-2 shrink-0">{metric.fmt(t.v)}</span>
                        </div>
                        <div className="mt-0.5 h-1.5 rounded-full bg-surface overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${w}%`, background: PLATFORM_COLOR[col.platform], opacity: 0.7 }}
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
