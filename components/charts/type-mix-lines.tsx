"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TYPE_LABEL } from "@/lib/palette";
import type { TypeDimensionSpendRow } from "@/db/queries/performance";

const TYPE_ORDER = ["video", "image", "slides"] as const;
const ALL_KEY = "__all__";
const ALL_COLOR = "var(--ink)";

export interface TypeLineKey {
  key: string;
  label: string;
  color: string;
}

interface Props {
  rows: TypeDimensionSpendRow[];
  /** Lines to draw (platforms, or top campaigns when pinned). */
  keys: TypeLineKey[];
  dimension: "platform" | "campaign";
  dimensionLabel?: string;
}

const pctTick = (v: number) => `${Math.round(v * 100)}%`;
const pctFull = (v: number | null) =>
  v === null ? "—" : `${(v * 100).toFixed(1)}%`;

type Point = { type: string } & Record<string, number | string | null>;

/**
 * Type mix as lines: each dimension (platform — or campaign when pinned) is a
 * line across the creative types, plotted as that line's OWN spend share per
 * type (so each line sums to 100% across the types). An emphasized "All" line
 * shows the blended split. Shows percentages, not amounts.
 */
export function TypeMixLines({ rows, keys, dimension, dimensionLabel }: Props) {
  const types = useMemo(
    () => TYPE_ORDER.filter((t) => rows.some((r) => r.type === t && r.spend > 0)),
    [rows],
  );

  const data = useMemo<Point[]>(() => {
    if (types.length === 0) return [];
    // Per-key totals (denominator for each line's shares).
    const keyTotal = new Map<string, number>();
    let grand = 0;
    for (const r of rows) {
      keyTotal.set(r.key, (keyTotal.get(r.key) ?? 0) + r.spend);
      grand += r.spend;
    }
    // Spend per (key, type) and per (all, type).
    const cell = new Map<string, number>(); // `${key}|${type}`
    const allByType = new Map<string, number>();
    for (const r of rows) {
      cell.set(`${r.key}|${r.type}`, (cell.get(`${r.key}|${r.type}`) ?? 0) + r.spend);
      allByType.set(r.type, (allByType.get(r.type) ?? 0) + r.spend);
    }
    return types.map((t) => {
      const point: Point = { type: TYPE_LABEL[t] };
      point[ALL_KEY] = grand > 0 ? (allByType.get(t) ?? 0) / grand : null;
      for (const k of keys) {
        const tot = keyTotal.get(k.key) ?? 0;
        point[k.key] = tot > 0 ? (cell.get(`${k.key}|${t}`) ?? 0) / tot : null;
      }
      return point;
    });
  }, [rows, keys, types]);

  const labelByKey = useMemo(() => {
    const m = new Map<string, string>([[ALL_KEY, "All"]]);
    for (const k of keys) m.set(k.key, k.label);
    return m;
  }, [keys]);

  return (
    <Card className="bg-surface border-line h-full flex flex-col">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-sm">Type mix</CardTitle>
        <span className="text-[11px] text-ink-3 font-normal">
          {dimension === "campaign"
            ? `by campaign${dimensionLabel ? ` · ${dimensionLabel}` : ""}`
            : "by platform"}
        </span>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-3">
        {/* Legend */}
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-2">
            <span className="h-2 w-3 rounded-sm" style={{ background: ALL_COLOR }} />
            All
          </span>
          {keys.map((k) => (
            <span
              key={k.key}
              className="inline-flex items-center gap-1.5 text-[11px] text-ink-3 max-w-[160px]"
              title={k.label}
            >
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ background: k.color }}
              />
              <span className="truncate">{k.label}</span>
            </span>
          ))}
        </div>

        {data.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-ink-3 text-sm">
            No spend in this window.
          </div>
        ) : (
          <div className="flex-1 min-h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="type"
                  tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                  stroke="var(--line-2)"
                  tickMargin={6}
                />
                <YAxis
                  domain={[0, 1]}
                  tickFormatter={pctTick}
                  tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                  stroke="var(--line-2)"
                  width={40}
                />
                <Tooltip content={<TypeTooltip labelByKey={labelByKey} />} />
                {keys.map((k) => (
                  <Line
                    key={k.key}
                    type="monotone"
                    dataKey={k.key}
                    stroke={k.color}
                    strokeWidth={1.6}
                    dot={{ r: 2 }}
                    activeDot={{ r: 4 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
                <Line
                  type="monotone"
                  dataKey={ALL_KEY}
                  stroke={ALL_COLOR}
                  strokeWidth={3}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                  connectNulls
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface TooltipPayloadEntry {
  dataKey: string;
  value: number | null;
  color: string;
}

function TypeTooltip({
  active,
  payload,
  label,
  labelByKey,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
  labelByKey: Map<string, string>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  // Emphasize "All" first.
  const ordered = [...payload].sort((a, b) =>
    a.dataKey === ALL_KEY ? -1 : b.dataKey === ALL_KEY ? 1 : 0,
  );
  return (
    <div className="rounded-md border border-line bg-popover/95 backdrop-blur px-3 py-2 text-xs shadow-lg">
      <div className="text-ink-2 mb-1.5">{label}</div>
      <div className="space-y-1">
        {ordered.map((p) => (
          <div key={p.dataKey} className="flex items-center gap-2 min-w-[150px]">
            <span
              className="w-2 h-2 rounded-sm shrink-0"
              style={{ background: p.color }}
            />
            <span className="text-ink-2 truncate max-w-[100px]">
              {labelByKey.get(p.dataKey) ?? p.dataKey}
            </span>
            <span className="ml-auto text-ink num">{pctFull(p.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
