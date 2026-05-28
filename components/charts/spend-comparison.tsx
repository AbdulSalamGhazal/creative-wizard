"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMemo } from "react";
import { usd } from "@/lib/format";
import type { SpendComparePoint } from "@/db/queries/performance";

interface Props {
  rows: SpendComparePoint[];
}

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const monthDay = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/**
 * Two daily-spend lines plotted on the same X axis by *day offset* — not
 * calendar date. That lets the eye compare "Day 5 of this window" against
 * "Day 5 of the prior window" without doing date math.
 *
 * Current = solid brand line. Prior = dashed muted line. The tooltip shows
 * both raw calendar dates so the comparison is unambiguous.
 */
export function SpendComparisonChart({ rows }: Props) {
  const hasData = useMemo(
    () => rows.some((r) => (r.current ?? 0) > 0 || (r.previous ?? 0) > 0),
    [rows],
  );

  if (!hasData) {
    return (
      <div className="h-64 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-md">
        No spend in either window.
      </div>
    );
  }

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="currentDate"
            tickFormatter={(d: string) => monthDay.format(new Date(d))}
            tick={{ fill: "var(--ink-3)", fontSize: 11 }}
            stroke="var(--line-2)"
            tickMargin={6}
            minTickGap={24}
          />
          <YAxis
            tickFormatter={(v: number) => compactUsd.format(v)}
            tick={{ fill: "var(--ink-3)", fontSize: 11 }}
            stroke="var(--line-2)"
            width={56}
          />
          <Tooltip content={<CompareTooltip />} />
          <Line
            type="monotone"
            dataKey="previous"
            stroke="var(--ink-3)"
            strokeWidth={1.2}
            strokeDasharray="4 4"
            dot={false}
            isAnimationActive
            animationDuration={700}
          />
          <Line
            type="monotone"
            dataKey="current"
            stroke="var(--brand)"
            strokeWidth={1.8}
            dot={false}
            isAnimationActive
            animationDuration={900}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-4 mt-2 text-[11px] text-ink-3">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block w-3 h-0.5 rounded-sm"
            style={{ background: "var(--brand)" }}
          />
          Current window
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block w-3 border-t border-dashed"
            style={{ borderColor: "var(--ink-3)" }}
          />
          Prior window (dashed)
        </span>
      </div>
    </div>
  );
}

interface TooltipPayloadEntry {
  dataKey: string;
  value: number;
  payload: SpendComparePoint;
}

function CompareTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  const current = payload.find((p) => p.dataKey === "current")?.value ?? 0;
  const previous = payload.find((p) => p.dataKey === "previous")?.value ?? 0;
  const delta = previous > 0 ? (current - previous) / previous : null;
  return (
    <div className="rounded-md border border-line bg-popover/95 backdrop-blur px-3 py-2 text-xs shadow-lg min-w-[200px]">
      <div className="flex items-center gap-2 mb-1">
        <span
          className="w-2 h-2 rounded-sm shrink-0"
          style={{ background: "var(--brand)" }}
        />
        <span className="text-ink-2">{monthDay.format(new Date(point.currentDate))}</span>
        <span className="ml-auto text-ink num">{usd(current)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className="inline-block w-2 border-t border-dashed shrink-0"
          style={{ borderColor: "var(--ink-3)" }}
        />
        <span className="text-ink-3">{monthDay.format(new Date(point.previousDate))}</span>
        <span className="ml-auto text-ink-2 num">{usd(previous)}</span>
      </div>
      {delta !== null && (
        <div className="flex items-center gap-2 pt-1 mt-1 border-t border-line">
          <span className="text-ink-3">Δ</span>
          <span
            className={
              "ml-auto num tabular-nums " +
              (delta >= 0 ? "text-pos" : "text-neg")
            }
          >
            {delta >= 0 ? "+" : ""}
            {(delta * 100).toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  );
}
