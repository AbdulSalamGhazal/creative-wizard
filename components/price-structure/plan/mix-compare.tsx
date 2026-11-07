"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { Line } from "@/price-structure/engine/blend";
import { pct1 } from "@/price-structure/format";
import { LADDER_COLOR } from "../palette";
import { SectionCard } from "../section-card";

export type MixGroup = "product" | "offer";

/** "Mix: plan vs actual" (brief §6.4): grouped bars of order share, by product or by offer. */
export function MixCompare({ planLines, actualLines, planName, periodName, group, onGroup }: { planLines: readonly Line[]; actualLines: readonly Line[]; planName: string; periodName: string; group: MixGroup; onGroup: (g: MixGroup) => void }) {
  const keyOf = (l: Line) => (group === "product" ? l.product.id : l.offer.id);
  const labelOf = (l: Line) => (group === "product" ? l.product.name : `${l.offer.name} · ${l.product.name}`);
  const shares = (lines: readonly Line[]) => {
    const out = new Map<string, { label: string; share: number }>();
    for (const l of lines) {
      const cur = out.get(keyOf(l)) ?? { label: labelOf(l), share: 0 };
      cur.share += l.share;
      out.set(keyOf(l), cur);
    }
    return out;
  };
  const plan = shares(planLines);
  const actual = shares(actualLines);
  const keys = [...new Set([...plan.keys(), ...actual.keys()])];
  const data = keys
    .map((k) => ({ key: k, label: (plan.get(k) ?? actual.get(k))!.label, plan: plan.get(k)?.share ?? 0, actual: actual.get(k)?.share ?? 0 }))
    .filter((d) => d.plan > 0 || d.actual > 0);
  const planLabel = `Plan (${planName})`;
  const actualLabel = `Actual (${periodName})`;
  return (
    <SectionCard
      title="Mix: plan vs actual"
      subtitle="Share of orders. A shift toward low-ROAS offers lowers the ROAS you can expect."
      actions={
        <SegmentedControl<MixGroup>
          ariaLabel="Group mix by"
          value={group}
          onChange={onGroup}
          options={[
            { value: "product", label: "By product" },
            { value: "offer", label: "By offer" },
          ]}
        />
      }
    >
      <div style={{ height: Math.max(140, data.length * 36 + 48) }} role="img" aria-label="Order share, plan beside actual">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 0, bottom: 0 }} barCategoryGap={8} barGap={2}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fill: "var(--ink-3)", fontSize: 10 }} stroke="var(--line-2)" tickFormatter={(v: number) => pct1(v)} domain={[0, 1]} />
            <YAxis type="category" dataKey="label" tick={{ fill: "var(--ink-2)", fontSize: 10 }} stroke="var(--line-2)" width={140} tickLine={false} interval={0} />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={(p: TooltipProps<number, string>) => {
                if (!p.active || !p.payload?.length) return null;
                const d = p.payload[0]!.payload as (typeof data)[number];
                return (
                  <ChartTooltip>
                    <div className="font-medium text-ink" dir="auto">{d.label}</div>
                    <div className="tabular-nums text-ink-2">{planLabel}: {pct1(d.plan)}</div>
                    <div className="tabular-nums text-ink-2">{actualLabel}: {pct1(d.actual)}</div>
                  </ChartTooltip>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="plan" name={planLabel} fill={LADDER_COLOR.planMix} isAnimationActive={false} radius={[0, 2, 2, 0]} />
            <Bar dataKey="actual" name={actualLabel} fill={LADDER_COLOR.actual} isAnimationActive={false} radius={[0, 2, 2, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </SectionCard>
  );
}
