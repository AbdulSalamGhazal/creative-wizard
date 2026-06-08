"use client";

import {
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { int, ratio, usd } from "@/lib/format";
import type { CreativePoint } from "@/db/queries/performance";

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

interface Point {
  name: string;
  spend: number;
  roas: number;
  /** ROAS clamped to the axis cap, for plotting (tooltip shows the real value). */
  roasPlot: number;
  conversions: number;
}

/**
 * Spend (x) vs ROAS (y) per creative, bubble size = conversions. Dots above the
 * break-even line (ROAS 1×) are green, below are red — so scaling winners
 * (right + green) separate from money pits (right + red) at a glance.
 */
export function RoasScatter({ points }: { points: CreativePoint[] }) {
  const valid = points.filter((p) => p.spend > 0 && p.roas !== null);

  // Cap the Y axis just above the 90th-percentile ROAS so a few outliers don't
  // stretch the whole axis; dots above the cap are clamped to the top edge
  // (their real ROAS still shows in the tooltip).
  const sortedRoas = valid.map((p) => p.roas as number).sort((a, b) => a - b);
  const p90 = sortedRoas.length
    ? sortedRoas[Math.min(sortedRoas.length - 1, Math.floor(sortedRoas.length * 0.9))]!
    : 4;
  const cap = Math.max(4, Math.ceil(p90 * 1.2));

  const data: Point[] = valid.map((p) => {
    const roas = p.roas as number;
    return {
      name: p.name,
      spend: p.spend,
      roas,
      roasPlot: Math.min(roas, cap),
      conversions: p.conversions ?? 0,
    };
  });

  return (
    <Card className="bg-surface border-line h-full flex flex-col">
      <CardHeader>
        <CardTitle className="text-sm">Spend vs ROAS</CardTitle>
      </CardHeader>
      <CardContent className="flex-1">
        {data.length === 0 ? (
          <div className="h-full min-h-[240px] flex items-center justify-center text-ink-3 text-sm">
            No rated spend in this window.
          </div>
        ) : (
          <div className="h-full min-h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 10, bottom: 2, left: 0 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="spend"
                  name="Spend"
                  tickFormatter={(v: number) => compactUsd.format(v)}
                  tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                  stroke="var(--line-2)"
                />
                <YAxis
                  type="number"
                  dataKey="roasPlot"
                  name="ROAS"
                  domain={[0, cap]}
                  allowDataOverflow
                  tickFormatter={(v: number) => `${v}×`}
                  tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                  stroke="var(--line-2)"
                  width={36}
                />
                <ZAxis type="number" dataKey="conversions" range={[24, 320]} />
                <ReferenceLine y={1} stroke="var(--ink-3)" strokeDasharray="4 4" />
                <Tooltip content={<ScatterTooltip />} cursor={{ strokeDasharray: "3 3" }} />
                <Scatter data={data} isAnimationActive={false}>
                  {data.map((d, i) => (
                    <Cell
                      key={i}
                      fill={d.roas >= 1 ? "var(--pos)" : "var(--neg)"}
                      fillOpacity={0.55}
                    />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScatterTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: Point }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="rounded-md border border-line bg-popover/95 backdrop-blur px-3 py-2 text-xs shadow-lg">
      <div className="text-ink mb-1 truncate max-w-[180px]">{p.name}</div>
      <div className="flex items-center gap-3">
        <span className="text-ink-3">Spend</span>
        <span className="ml-auto num text-ink">{usd(p.spend)}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-ink-3">ROAS</span>
        <span className="ml-auto num text-ink">{ratio(p.roas)}×</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-ink-3">Conversions</span>
        <span className="ml-auto num text-ink">{int(p.conversions)}</span>
      </div>
    </div>
  );
}
