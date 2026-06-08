"use client";

import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { rateBlock, RATING_VALUES, type Rating, type RatingConfig } from "@/lib/rating";
import { usd } from "@/lib/format";
import type { CreativePoint } from "@/db/queries/performance";

const COLOR: Record<Rating, string> = {
  good: "var(--pos)",
  decent: "var(--warn)",
  bad: "var(--neg)",
  na: "var(--ink-3)",
};
const LABEL: Record<Rating, string> = {
  good: "Good",
  decent: "Decent",
  bad: "Bad",
  na: "N/A",
};

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

/**
 * How spend splits across performance ratings (Good / Decent / Bad / N/A) using
 * the brand's ROAS-based rating rules — what share of money is working — as a
 * donut with the total spend in the center and a legend below.
 */
export function RatingDistribution({
  points,
  config,
}: {
  points: CreativePoint[];
  config: RatingConfig;
}) {
  const { data, total } = useMemo(() => {
    const rules = config.default;
    const spend: Record<Rating, number> = { good: 0, decent: 0, bad: 0, na: 0 };
    let sum = 0;
    for (const p of points) {
      const r = rateBlock({ spend: p.spend, roas: p.roas }, rules);
      spend[r] += p.spend;
      sum += p.spend;
    }
    const slices = RATING_VALUES.map((r) => ({
      key: r,
      label: LABEL[r],
      value: spend[r],
      color: COLOR[r],
      share: sum > 0 ? spend[r] / sum : 0,
    })).filter((s) => s.value > 0);
    return { data: slices, total: sum };
  }, [points, config]);

  return (
    <Card className="bg-surface border-line h-full flex flex-col">
      <CardHeader>
        <CardTitle className="text-sm">Spend by rating</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col">
        {data.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-ink-3 text-sm">
            No spend in this window.
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 h-full">
            <div className="relative flex-1 min-h-[150px] w-full">
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
                    animationDuration={700}
                  >
                    {data.map((d) => (
                      <Cell key={d.key} fill={d.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<RatingTooltip />} />
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
            <ul className="w-full grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              {data.map((d) => (
                <li key={d.key} className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ background: d.color }}
                  />
                  <span className="text-ink-2 flex-1 truncate">{d.label}</span>
                  <span className="text-ink num shrink-0">
                    {(d.share * 100).toFixed(0)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RatingTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { label: string; value: number; share: number; color: string } }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const e = payload[0]?.payload;
  if (!e) return null;
  return (
    <div className="rounded-md border border-line bg-popover/95 backdrop-blur px-3 py-2 text-xs shadow-lg">
      <div className="flex items-center gap-2 mb-1">
        <span
          className="w-2 h-2 rounded-sm shrink-0"
          style={{ background: e.color }}
        />
        <span className="text-ink">{e.label}</span>
      </div>
      <div className="flex items-baseline gap-3 min-w-[140px]">
        <span className="text-ink-3">Spend</span>
        <span className="ml-auto text-ink num">{usd(e.value)}</span>
      </div>
      <div className="flex items-baseline gap-3">
        <span className="text-ink-3">Share</span>
        <span className="ml-auto text-ink num">{(e.share * 100).toFixed(1)}%</span>
      </div>
    </div>
  );
}
