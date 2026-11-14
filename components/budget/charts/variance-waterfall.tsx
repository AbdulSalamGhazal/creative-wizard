"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartHeader, ChartShell, ExpandButton, plotClass } from "@/components/charts/chart-shell";
import { CHART_CURSOR, ChartTooltip } from "@/components/charts/chart-tooltip";
import { PACING_COLOR } from "@/lib/palette";
import { signedPct } from "@/lib/format";
import { isStrongTone, pacingTone, round2, type RangePlatform } from "@/lib/budget";

interface Step {
  key: string;
  label: string;
  /** The invisible lift under the visible bar. */
  base: number;
  /** The visible bar's height (always ≥ 0). */
  size: number;
  /** The signed amount the step stands for (USD). */
  amount: number;
  kind: "expected" | "delta" | "actual";
  deviation: number | null;
}

/**
 * From plan to actual, platform by platform: the first bar is what the plan
 * EXPECTED through each platform's own covered day (the sum of the board's
 * rows — never the whole range's plan while it is still running), each
 * floating bar is one platform's over- or under-spend against that, and the
 * last bar is what was actually spent. It answers "who made the difference"
 * in one look, which a cumulative line cannot.
 *
 * Direction colours only past the threshold (`pacingTone`); a platform with
 * no plan is a neutral bar — it has no verdict.
 */
export function VarianceWaterfall({
  rows,
  title,
  label,
  toDisplay,
  fmt,
  compact,
}: {
  rows: readonly RangePlatform[];
  title: string;
  label: (platform: string) => string;
  toDisplay: (usd: number) => number;
  fmt: (usd: number) => string;
  compact: (usd: number) => string;
}) {
  const expected = round2(rows.reduce((s, r) => s + r.planToDate, 0));
  const actual = round2(rows.reduce((s, r) => s + r.actual, 0));
  if (expected <= 0 && actual <= 0) return null;

  const steps: Step[] = [
    { key: "expected", label: "Expected", base: 0, size: expected, amount: expected, kind: "expected", deviation: null },
  ];
  let running = expected;
  for (const r of rows) {
    const delta = round2(r.actual - r.planToDate);
    if (delta === 0) continue;
    const next = running + delta;
    steps.push({
      key: r.key,
      label: label(r.key),
      base: Math.min(running, next),
      size: Math.abs(delta),
      amount: delta,
      kind: "delta",
      deviation: r.planToDate > 0 ? r.deviation : null,
    });
    running = next;
  }
  steps.push({ key: "actual", label: "Actual", base: 0, size: actual, amount: actual, kind: "actual", deviation: null });

  const data = steps.map((s) => ({ ...s, base: toDisplay(s.base), size: toDisplay(s.size) }));
  const perUsd = toDisplay(1) || 1;
  const fill = (s: Step) => {
    if (s.kind !== "delta") return s.kind === "actual" ? "var(--ink-2)" : "var(--ink-3)";
    const tone = pacingTone(s.deviation);
    if (!isStrongTone(tone)) return "var(--ink-3)";
    return tone.direction === "ahead" ? PACING_COLOR.ahead : PACING_COLOR.behind;
  };

  return (
    <ChartShell
      summary={`From expected to actual spend, ${title}: expected ${fmt(expected)}, ${steps
        .filter((s) => s.kind === "delta")
        .map((s) => `${s.label} ${s.amount > 0 ? "over" : "under"} by ${fmt(Math.abs(s.amount))}`)
        .join(", ")}, actual ${fmt(actual)}.`}
    >
      {({ inFull, toggleExpand }) => (
        <>
          <ChartHeader
            title="Expected to actual, by platform"
            controls={<ExpandButton inFull={inFull} onClick={toggleExpand} />}
          />
          <div className={plotClass(inFull, "md")}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart accessibilityLayer data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                  stroke="var(--line-2)"
                  tickMargin={6}
                  interval={0}
                />
                <YAxis
                  tickFormatter={(v: number) => compact(v / perUsd)}
                  tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                  stroke="var(--line-2)"
                  width={56}
                />
                <Tooltip
                  cursor={CHART_CURSOR}
                  content={({ active, payload }) => {
                    const s = payload?.[0]?.payload as Step | undefined;
                    if (!active || !s) return null;
                    return (
                      <ChartTooltip>
                        <div className="mb-1 font-medium text-ink">{s.label}</div>
                        <p className="tabular-nums">
                          {s.kind === "delta" && (s.amount > 0 ? "+" : "−")}
                          {fmt(Math.abs(s.amount))}
                          {s.kind === "delta" && s.deviation !== null && ` (${signedPct(s.deviation, 0)})`}
                        </p>
                        {s.kind === "delta" && s.deviation === null && (
                          <p className="text-ink-2">no plan</p>
                        )}
                      </ChartTooltip>
                    );
                  }}
                />
                <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
                <Bar dataKey="size" stackId="w" isAnimationActive={false} radius={2}>
                  {steps.map((s) => (
                    <Cell key={s.key} fill={fill(s)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </ChartShell>
  );
}
