"use client";

import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { ChartHeader, ChartShell, ExpandButton, plotClass } from "@/components/charts/chart-shell";
import { CHART_CURSOR, ChartTooltip } from "@/components/charts/chart-tooltip";
import { EmptyState } from "@/components/ui/empty-state";
import { PLATFORM_COLOR, seriesColor } from "@/lib/palette";
import { int, roas as fmtRoas } from "@/lib/format";
import type { ResultRow } from "@/lib/budget-results";

/** Teal — the results hue, clear of every platform's identity colour. */
const RESULT_COLOR = seriesColor(11);

interface Point {
  label: string;
  x: number;
  y: number;
  z: number;
  row: ResultRow;
  fill: string;
}

/**
 * Spend against PLATFORM-REPORTED ROAS, one bubble per row of the results
 * lens (a platform, an objective, a product), sized by purchases. Big spend
 * low on the chart is where the money isn't coming back; small spend high up
 * is where there may be room. Figures only — no target line but break-even,
 * and no verdict colour (blue and amber mean pacing in Budget).
 */
export function ResultsBubble({
  rows,
  title,
  toDisplay,
  fmt,
  fmtCents,
  compact,
}: {
  rows: readonly ResultRow[];
  title: string;
  toDisplay: (usd: number) => number;
  fmt: (usd: number) => string;
  fmtCents: (usd: number) => string;
  compact: (usd: number) => string;
}) {
  const data: Point[] = rows.flatMap((r) =>
    r.results.roas === null
      ? []
      : [
          {
            label: r.label,
            x: toDisplay(r.spend),
            y: r.results.roas,
            z: Math.max(1, r.results.purchases ?? 1),
            row: r,
            fill:
              r.platform && r.platform in PLATFORM_COLOR
                ? PLATFORM_COLOR[r.platform as keyof typeof PLATFORM_COLOR]
                : RESULT_COLOR,
          },
        ],
  );
  const perUsd = toDisplay(1) || 1;
  return (
    <ChartShell
      summary={`Spend against platform-reported ROAS, ${title}: ${data
        .map((p) => `${p.label} ${fmt(p.row.spend)} at ${fmtRoas(p.y)}`)
        .join("; ")}.`}
    >
      {({ inFull, toggleExpand }) => (
        <>
          <ChartHeader
            title="Spend against ROAS"
            controls={<ExpandButton inFull={inFull} onClick={toggleExpand} />}
          />
          {data.length === 0 ? (
            <EmptyState
              className="flex h-56 flex-col items-center justify-center py-0"
              title="Nothing here reports purchase value."
              buttons={false}
            />
          ) : (
            <div className={plotClass(inFull, "md")}>
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart accessibilityLayer margin={{ top: 12, right: 16, left: 4, bottom: 8 }}>
                  <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    name="Spend"
                    tickFormatter={(v: number) => compact(v / perUsd)}
                    tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                    stroke="var(--line-2)"
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    name="ROAS"
                    tickFormatter={(v: number) => `${v.toFixed(1)}×`}
                    tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                    stroke="var(--line-2)"
                    width={48}
                  />
                  <ZAxis type="number" dataKey="z" range={[60, 520]} />
                  <ReferenceLine
                    y={1}
                    stroke="var(--ink-3)"
                    strokeDasharray="4 4"
                    label={{ value: "break-even", fill: "var(--ink-3)", fontSize: 10, position: "insideTopRight" }}
                  />
                  <Tooltip
                    cursor={CHART_CURSOR}
                    content={({ active, payload }) => {
                      const p = payload?.[0]?.payload as Point | undefined;
                      if (!active || !p) return null;
                      return (
                        <ChartTooltip className="max-w-xs">
                          <div className="mb-1 truncate font-medium text-ink">{p.label}</div>
                          <p className="tabular-nums">{fmt(p.row.spend)} spent</p>
                          <p className="tabular-nums">
                            {fmtRoas(p.row.results.roas)} · {int(p.row.results.purchases)} purchases
                          </p>
                          {p.row.results.cpa !== null && (
                            <p className="tabular-nums text-ink-2">{fmtCents(p.row.results.cpa)} per purchase</p>
                          )}
                        </ChartTooltip>
                      );
                    }}
                  />
                  <Scatter
                    data={data}
                    isAnimationActive={false}
                    shape={(props: unknown) => {
                      const { cx, cy, size, payload } = props as {
                        cx: number;
                        cy: number;
                        size: number;
                        payload: Point;
                      };
                      const r = Math.sqrt(size / Math.PI);
                      return (
                        <g>
                          <circle cx={cx} cy={cy} r={r} fill={payload.fill} fillOpacity={0.55} stroke={payload.fill} />
                          <text x={cx} y={cy - r - 4} textAnchor="middle" fontSize={11} fill="var(--ink-2)">
                            {payload.label.length > 18 ? `${payload.label.slice(0, 17)}…` : payload.label}
                          </text>
                        </g>
                      );
                    }}
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </ChartShell>
  );
}
