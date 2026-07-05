"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ALL_PLATFORMS, PLATFORM_LABEL, TYPE_COLOR, TYPE_LABEL } from "@/lib/palette";
import { int, pct, ratio, usd, usdCompact, intCompact } from "@/lib/format";
import { MetricPicker } from "@/components/charts/metric-picker";
import type { TypeRollupRow } from "@/db/queries/trends";
import { ChartTooltip } from "@/components/charts/chart-tooltip";

type Metric = "spend" | "impressions" | "roas" | "ctr" | "cvr" | "cpc" | "cpa";
type CreativeType = TypeRollupRow["type"];
const TYPES: CreativeType[] = ["video", "image", "slides"];


const METRICS: Record<
  Metric,
  { label: string; cell: (v: number | null) => string; axis: (v: number) => string }
> = {
  spend: { label: "Spend", cell: usd, axis: (v) => usdCompact(v) },
  impressions: { label: "Impressions", cell: int, axis: (v) => intCompact(v) },
  roas: {
    label: "ROAS",
    cell: (v) => (v === null ? "—" : `${ratio(v)}×`),
    axis: (v) => `${ratio(v)}×`,
  },
  ctr: { label: "CTR", cell: pct, axis: (v) => pct(v) },
  cvr: { label: "CvR", cell: pct, axis: (v) => pct(v) },
  cpc: { label: "CPC", cell: usd, axis: (v) => usdCompact(v) },
  cpa: { label: "CPA", cell: usd, axis: (v) => usdCompact(v) },
};
const METRIC_ORDER: Metric[] = ["spend", "impressions", "roas", "ctr", "cvr", "cpc", "cpa"];

type ChartRow = { platform: string } & Partial<Record<CreativeType, number | null>>;

/**
 * Performance by platform (x-axis), with one bar per creative type. The metric
 * switcher re-bases the bars. Platform is the parent grouping, type the child.
 */
export function TypePlatformChart({ rows }: { rows: TypeRollupRow[] }) {
  const [metric, setMetric] = useState<Metric>("spend");

  const data = useMemo<ChartRow[]>(() => {
    const byPlatform = new Map<string, ChartRow>();
    for (const r of rows) {
      const p = r.platform ?? "all";
      const entry = byPlatform.get(p) ?? { platform: p };
      entry[r.type] = r[metric];
      byPlatform.set(p, entry);
    }
    // Stable platform order.
    return ALL_PLATFORMS.filter((p) => byPlatform.has(p)).map(
      (p) => byPlatform.get(p)!,
    );
  }, [rows, metric]);

  if (data.length === 0) {
    return (
      <div className="h-72 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-lg">
        No performance in this window.
      </div>
    );
  }

  const m = METRICS[metric];

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div className="flex items-center gap-3">
          {TYPES.map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5 text-[11px] text-ink-2">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: TYPE_COLOR[t] }} />
              {TYPE_LABEL[t]}
            </span>
          ))}
        </div>
        <MetricPicker
          options={METRIC_ORDER.map((key) => ({ value: key, label: METRICS[key].label }))}
          value={metric}
          onChange={setMetric}
        />
      </div>

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="platform"
              tickFormatter={(p: string) =>
                PLATFORM_LABEL[p as keyof typeof PLATFORM_LABEL] ?? p
              }
              tick={{ fill: "var(--ink-2)", fontSize: 11 }}
              stroke="var(--line-2)"
              tickMargin={8}
            />
            <YAxis
              tickFormatter={(v: number) => m.axis(v)}
              tick={{ fill: "var(--ink-3)", fontSize: 11 }}
              stroke="var(--line-2)"
              width={56}
            />
            <Tooltip
              cursor={{ fill: "var(--surface-2)", opacity: 0.4 }}
              content={<TypeTooltip metric={metric} />}
            />
            {TYPES.map((t) => (
              <Bar
                key={t}
                dataKey={t}
                name={TYPE_LABEL[t]}
                fill={TYPE_COLOR[t]}
                radius={[3, 3, 0, 0]}
                maxBarSize={46}
                isAnimationActive
                animationDuration={650}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

interface TipEntry {
  dataKey: CreativeType;
  value: number | null;
  payload: ChartRow;
}

function TypeTooltip({
  active,
  payload,
  metric,
}: {
  active?: boolean;
  payload?: TipEntry[];
  metric: Metric;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const platform = payload[0]?.payload.platform ?? "";
  const m = METRICS[metric];
  return (
    <ChartTooltip>
      <div className="text-ink font-medium mb-1.5">
        {PLATFORM_LABEL[platform as keyof typeof PLATFORM_LABEL] ?? platform}
      </div>
      <div className="space-y-1">
        {TYPES.map((t) => {
          const entry = payload.find((p) => p.dataKey === t);
          return (
            <div key={t} className="flex items-center justify-between gap-4">
              <span className="inline-flex items-center gap-1.5 text-ink-2">
                <span className="w-2 h-2 rounded-sm" style={{ background: TYPE_COLOR[t] }} />
                {TYPE_LABEL[t]}
              </span>
              <span className="text-ink tabular-nums">
                {m.cell(entry?.value ?? null)}
              </span>
            </div>
          );
        })}
      </div>
    </ChartTooltip>
  );
}
