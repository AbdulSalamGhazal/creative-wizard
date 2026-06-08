"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useMemo } from "react";
import { productColor } from "@/lib/palette";
import { usd } from "@/lib/format";
import type { ProductMixRow } from "@/db/queries/performance";

interface Props {
  rows: ProductMixRow[];
}

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function ProductMixDonut({ rows }: Props) {
  const { data, total } = useMemo(() => {
    const filtered = rows.filter((r) => r.spend > 0);
    const sum = filtered.reduce((s, r) => s + r.spend, 0);
    return {
      data: filtered.map((r) => ({
        ...r,
        share: sum > 0 ? r.spend / sum : 0,
        color: productColor(r.productName),
      })),
      total: sum,
    };
  }, [rows]);

  if (data.length === 0) {
    return (
      <div className="h-44 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-md">
        No spend in the selected window.
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Donut (full width, uncompressed) */}
      <div className="relative h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="spend"
              nameKey="productName"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={1.5}
              stroke="var(--surface)"
              strokeWidth={2}
              isAnimationActive
              animationDuration={800}
            >
              {data.map((d) => (
                <Cell key={d.productId} fill={d.color} />
              ))}
            </Pie>
            <Tooltip content={<DonutTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-[10px] uppercase tracking-[0.18em] text-ink-3">
            Total spend
          </div>
          <div className="font-display text-2xl num text-ink mt-1">
            {compactUsd.format(total)}
          </div>
        </div>
      </div>
      {/* Legend below */}
      <ul className="w-full grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs max-h-28 overflow-y-auto">
        {data.map((d) => (
          <li key={d.productId} className="flex items-center gap-2 min-w-0">
            <span
              className="w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ background: d.color }}
            />
            <span className="text-ink-2 flex-1 truncate" title={d.productName}>
              {d.productName}
            </span>
            <span className="text-ink num shrink-0">
              {(d.share * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface TooltipPayloadEntry {
  payload: {
    productName: string;
    spend: number;
    share: number;
    color: string;
  };
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
        <span className="text-ink">{entry.productName}</span>
      </div>
      <div className="flex items-baseline gap-3 min-w-[140px]">
        <span className="text-ink-3">Spend</span>
        <span className="ml-auto text-ink num">{usd(entry.spend)}</span>
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
