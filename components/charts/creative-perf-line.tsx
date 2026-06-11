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
import { ALL_PLATFORMS, PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { usd } from "@/lib/format";
import type { SpendByDatePlatform } from "@/db/queries/performance";

interface Props {
  rows: SpendByDatePlatform[];
}

interface PivotRow {
  date: string;
  instagram: number | null;
  facebook: number | null;
  tiktok: number | null;
  snapchat: number | null;
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

export function CreativePerfLineChart({ rows }: Props) {
  const data = useMemo<PivotRow[]>(() => {
    if (rows.length === 0) return [];
    const byDate = new Map<string, PivotRow>();
    for (const r of rows) {
      let existing = byDate.get(r.date);
      if (!existing) {
        existing = {
          date: r.date,
          instagram: null,
          facebook: null,
          tiktok: null,
          snapchat: null,
        };
        byDate.set(r.date, existing);
      }
      existing[r.platform] = r.spend;
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [rows]);

  const presentPlatforms = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.platform);
    return ALL_PLATFORMS.filter((p) => set.has(p));
  }, [rows]);

  if (data.length === 0) {
    return (
      <div className="h-72 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-md">
        No performance records for this creative.
      </div>
    );
  }

  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => monthDay.format(new Date(d))}
            tick={{ fill: "var(--ink-3)", fontSize: 11 }}
            stroke="var(--line-2)"
            tickMargin={6}
          />
          <YAxis
            tickFormatter={(v: number) => compactUsd.format(v)}
            tick={{ fill: "var(--ink-3)", fontSize: 11 }}
            stroke="var(--line-2)"
            width={56}
          />
          <Tooltip content={<LineTooltip />} />
          {presentPlatforms.map((p) => (
            <Line
              key={p}
              type="monotone"
              dataKey={p}
              stroke={PLATFORM_COLOR[p]}
              strokeWidth={2}
              dot={{ r: 2.5, fill: PLATFORM_COLOR[p], strokeWidth: 0 }}
              activeDot={{ r: 4 }}
              connectNulls={false}
              isAnimationActive
              animationDuration={900}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

interface TooltipPayloadEntry {
  dataKey: string;
  value: number | null;
  color: string;
}

function LineTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0 || !label) return null;
  return (
    <div className="rounded-md border border-line bg-popover/95 backdrop-blur px-3 py-2 text-xs shadow-lg">
      <div className="text-ink-2 mb-1.5">
        {monthDay.format(new Date(label))}
      </div>
      <div className="space-y-1">
        {payload.map((p) => (
          <div key={p.dataKey} className="flex items-center gap-2 min-w-[160px]">
            <span
              className="w-2 h-2 rounded-sm shrink-0"
              style={{ background: p.color }}
            />
            <span className="text-ink-2">
              {PLATFORM_LABEL[p.dataKey as keyof typeof PLATFORM_LABEL]}
            </span>
            <span className="ml-auto text-ink num">
              {p.value === null ? "—" : usd(p.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
