"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useMemo } from "react";
import { usd } from "@/lib/format";

export interface MixSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

interface Props {
  slices: MixSlice[];
  /** Center caption above the total (e.g. "Total spend"). */
  centerLabel?: string;
  /** Empty-state copy. */
  emptyText?: string;
}

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

/**
 * Generic spend-share donut. Feed it labeled, colored slices and it renders
 * a donut + legend with share percentages and a centered total. Used for
 * the Overview type-mix and tag-mix charts (and reusable for any future
 * spend-by-X breakdown).
 */
export function MixDonut({
  slices,
  centerLabel = "Total spend",
  emptyText = "No spend in the selected window.",
}: Props) {
  const { data, total } = useMemo(() => {
    const filtered = slices.filter((s) => s.value > 0);
    const sum = filtered.reduce((acc, s) => acc + s.value, 0);
    return {
      data: filtered.map((s) => ({
        ...s,
        share: sum > 0 ? s.value / sum : 0,
      })),
      total: sum,
    };
  }, [slices]);

  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-md">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="h-64 grid grid-cols-[1fr_auto] items-center gap-4">
      <div className="relative h-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={1.5}
              stroke="var(--surface)"
              strokeWidth={2}
              isAnimationActive
              animationDuration={800}
            >
              {data.map((d) => (
                <Cell key={d.key} fill={d.color} />
              ))}
            </Pie>
            <Tooltip content={<DonutTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-[10px] uppercase tracking-[0.18em] text-ink-3">
            {centerLabel}
          </div>
          <div className="font-display text-2xl num text-ink mt-1">
            {compactUsd.format(total)}
          </div>
        </div>
      </div>
      <ul className="space-y-2 text-xs min-w-[140px] max-h-56 overflow-y-auto">
        {data.map((d) => (
          <li key={d.key} className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ background: d.color }}
            />
            <span className="text-ink-2 flex-1 truncate" title={d.label}>
              {d.label}
            </span>
            <span className="text-ink num">{(d.share * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface TooltipPayloadEntry {
  payload: { label: string; value: number; share: number; color: string };
}

function DonutTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0]?.payload;
  if (!entry) return null;
  return (
    <div className="rounded-md border border-line bg-popover/95 backdrop-blur px-3 py-2 text-xs shadow-lg">
      <div className="flex items-center gap-2 mb-1">
        <span
          className="w-2 h-2 rounded-sm shrink-0"
          style={{ background: entry.color }}
        />
        <span className="text-ink">{entry.label}</span>
      </div>
      <div className="flex items-baseline gap-3 min-w-[140px]">
        <span className="text-ink-3">Spend</span>
        <span className="ml-auto text-ink num">{usd(entry.value)}</span>
      </div>
      <div className="flex items-baseline gap-3">
        <span className="text-ink-3">Share</span>
        <span className="ml-auto text-ink num">
          {(entry.share * 100).toFixed(1)}%
        </span>
      </div>
    </div>
  );
}
