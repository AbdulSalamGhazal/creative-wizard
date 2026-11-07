"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import type { OfferRow } from "@/price-structure/engine/all-offers";
import { METRICS, metricValue } from "@/price-structure/engine/metrics";
import type { MetricKey, Target } from "@/price-structure/engine/types";
import { formatMetric } from "@/price-structure/format";
import { MetricSelect } from "../metric-select";
import { productColor } from "../palette";
import { SectionCard } from "../section-card";

/**
 * "Compare offers" (brief §6.1): a horizontal bar per offer of one metric,
 * coloured by product, with dashed A / B reference lines for every enabled
 * target on that metric.
 */
export function CompareOffersChart({
  rows,
  targets,
  metric,
  onMetric,
  monthly,
}: {
  rows: readonly OfferRow[];
  targets: readonly Target[];
  metric: MetricKey;
  onMetric: (m: MetricKey) => void;
  monthly: boolean;
}) {
  const meta = METRICS[metric];
  const data = useMemo(
    () =>
      rows.map((row) => {
        const v = metricValue(row.r, metric);
        return {
          key: row.offer.id,
          label: row.offer.name,
          product: row.product.name,
          color: productColor(row.product.colorSlot),
          value: Number.isFinite(v) ? v : null,
          raw: v,
        };
      }),
    [rows, metric],
  );
  const lines = targets.filter((t) => t.enabled && t.metric === metric);
  const products = useMemo(() => {
    const seen = new Map<string, { name: string; color: string }>();
    for (const row of rows) seen.set(row.product.id, { name: row.product.name, color: productColor(row.product.colorSlot) });
    return [...seen.values()];
  }, [rows]);
  const fmt = (v: number | null | undefined) => formatMetric(metric, v);

  return (
    <SectionCard
      title="Compare offers"
      info={meta.description}
      actions={<MetricSelect value={metric} onChange={onMetric} monthly={monthly} ariaLabel="Compare offers by" />}
    >
      <div style={{ height: Math.max(120, data.length * 26 + 36) }} role="img" aria-label={`${meta.label} per offer`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart accessibilityLayer data={data} layout="vertical" margin={{ top: 4, right: 24, left: 0, bottom: 0 }} barCategoryGap={4}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fill: "var(--ink-3)", fontSize: 10 }} stroke="var(--line-2)" tickFormatter={(v: number) => fmt(v)} />
            <YAxis
              type="category"
              dataKey="label"
              tick={{ fill: "var(--ink-2)", fontSize: 10 }}
              stroke="var(--line-2)"
              width={120}
              tickLine={false}
              interval={0}
            />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={(p: TooltipProps<number, string>) => {
                if (!p.active || !p.payload?.length) return null;
                const d = p.payload[0]!.payload as (typeof data)[number];
                return (
                  <ChartTooltip>
                    <div className="font-medium text-ink" dir="auto">{d.label}</div>
                    <div className="text-ink-3" dir="auto">{d.product}</div>
                    <div className="mt-1 tabular-nums text-ink">{meta.short} {fmt(d.raw)}</div>
                  </ChartTooltip>
                );
              }}
            />
            {lines.flatMap((t) => [
              <ReferenceLine key={`${t.id}-a`} x={t.a} stroke="var(--warn)" strokeDasharray="4 3" label={{ value: `A ${fmt(t.a)}`, position: "insideTopRight", fill: "var(--warn)", fontSize: 10 }} />,
              <ReferenceLine key={`${t.id}-b`} x={t.b} stroke="var(--pos)" strokeDasharray="4 3" label={{ value: `B ${fmt(t.b)}`, position: "insideBottomRight", fill: "var(--pos)", fontSize: 10 }} />,
            ])}
            <Bar dataKey="value" isAnimationActive={false} radius={[0, 2, 2, 0]}>
              {data.map((d) => (
                <Cell key={d.key} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-3">
        {products.map((p) => (
          <span key={p.name} className="inline-flex items-center gap-1">
            <span className="size-2 rounded-full" style={{ background: p.color }} aria-hidden />
            <span dir="auto">{p.name}</span>
          </span>
        ))}
      </div>
    </SectionCard>
  );
}
