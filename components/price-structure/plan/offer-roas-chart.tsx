"use client";

import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { EmptyState } from "@/components/ui/empty-state";
import type { Blend, Line } from "@/price-structure/engine/blend";
import { pct1, roas2 } from "@/price-structure/format";
import { productColor } from "../palette";
import { SectionCard } from "../section-card";

/**
 * "Each offer's ROAS vs the blend" (brief §6.4): a bar per offer with
 * orders, its platform ROAS in the product colour, a reference line at the
 * blend. Offers below the line pull the account ROAS down.
 */
export function OfferRoasChart({ lines, total }: { lines: readonly Line[]; total: Blend }) {
  const active = lines.filter((l) => l.orders > 0);
  const spend = active.reduce((s, l) => s + l.orders * l.r.adSpend, 0);
  const data = active.map((l) => ({
    key: l.offer.id,
    label: l.offer.name,
    sub: `${l.product.name} · ${pct1(spend > 0 ? (l.orders * l.r.adSpend) / spend : 0)} of spend`,
    color: productColor(l.product.colorSlot),
    value: Number.isFinite(l.r.platformRoas) ? l.r.platformRoas : null,
  }));
  return (
    <SectionCard title="Each offer's ROAS vs the blend" subtitle="Offers below the line pull the account ROAS down. Each offer counts by its share of ad spend.">
      {data.length === 0 ? (
        <EmptyState title="No orders planned: set orders per day and a mix." size="sm" />
      ) : (
        <div style={{ height: Math.max(120, data.length * 30 + 36) }} role="img" aria-label={`Platform ROAS per offer; blend ${roas2(total.platformRoas)}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, left: 0, bottom: 0 }} barCategoryGap={6}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fill: "var(--ink-3)", fontSize: 10 }} stroke="var(--line-2)" tickFormatter={(v: number) => roas2(v)} />
              <YAxis type="category" dataKey="label" tick={{ fill: "var(--ink-2)", fontSize: 10 }} stroke="var(--line-2)" width={120} tickLine={false} interval={0} />
              <Tooltip
                cursor={{ fill: "var(--surface-2)" }}
                content={(p: TooltipProps<number, string>) => {
                  if (!p.active || !p.payload?.length) return null;
                  const d = p.payload[0]!.payload as (typeof data)[number];
                  return (
                    <ChartTooltip>
                      <div className="font-medium text-ink" dir="auto">{d.label}</div>
                      <div className="text-ink-3" dir="auto">{d.sub}</div>
                      <div className="mt-1 num tabular-nums text-ink">Platform ROAS {roas2(d.value)}</div>
                    </ChartTooltip>
                  );
                }}
              />
              {Number.isFinite(total.platformRoas) && (
                <ReferenceLine x={total.platformRoas} stroke="var(--brand)" strokeDasharray="4 3" label={{ value: `Blend ${roas2(total.platformRoas)}`, position: "insideTopRight", fill: "var(--brand)", fontSize: 10 }} />
              )}
              <Bar dataKey="value" isAnimationActive={false} radius={[0, 2, 2, 0]}>
                {data.map((d) => (
                  <Cell key={d.key} fill={d.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </SectionCard>
  );
}
