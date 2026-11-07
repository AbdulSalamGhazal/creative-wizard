"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { evaluateOffer } from "@/price-structure/engine/evaluate";
import type { Offer, Product, VersionData } from "@/price-structure/engine/types";
import { money0, money2, pct1 } from "@/price-structure/format";
import { PART_COLOR } from "../palette";
import { SectionCard } from "../section-card";

interface Step {
  name: string;
  /** Invisible riser the visible bar sits on. */
  base: number;
  value: number;
  color: string;
  total: boolean;
}

/**
 * "From customer price to Clean Money Left" (brief §6.2): a waterfall per
 * delivered order. Totals stand on the axis; each cost hangs off the running
 * total above it. Labels sit above the bars; the tooltip adds "% of net
 * revenue".
 */
export function OfferWaterfall({ product, offer, data }: { product: Product; offer: Offer; data: VersionData }) {
  const r = useMemo(() => evaluateOffer(product, offer, data.settings), [product, offer, data.settings]);
  const steps = useMemo<Step[]>(() => {
    const out: Step[] = [];
    const total = (name: string, value: number, color: string) => out.push({ name, base: 0, value, color, total: true });
    const minus = (name: string, amount: number, from: number, color: string) =>
      out.push({ name, base: from - amount, value: amount, color, total: false });
    total("Customer pays", r.paidGross, "var(--series-4)");
    minus("VAT", r.vat, r.paidGross, "var(--ink-3)");
    total("Net revenue", r.netRevenue, "var(--series-4)");
    let running = r.netRevenue;
    minus("COGS", r.cogs, running, PART_COLOR.cogs);
    running -= r.cogs;
    minus("Marketing", r.marketing, running, PART_COLOR.marketing);
    running -= r.marketing;
    if (r.undelivered > 0) {
      minus("Undelivered", r.undelivered, running, PART_COLOR.undelivered);
      running -= r.undelivered;
    }
    total("CML", r.profit, r.profit < 0 ? "var(--neg)" : PART_COLOR.cml);
    return out;
  }, [r]);

  // A negative CML needs room below the axis; the riser trick needs none.
  const floor = Math.min(0, r.profit);

  return (
    <SectionCard title="From customer price to Clean Money Left" subtitle="SAR per delivered order">
      <div style={{ height: 240 }} role="img" aria-label={`Customer pays ${money2(r.paidGross)} SAR, net revenue ${money2(r.netRevenue)}, CML ${money2(r.profit)}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={steps} margin={{ top: 20, right: 8, left: 0, bottom: 0 }} barCategoryGap={8}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: "var(--ink-3)", fontSize: 10 }} stroke="var(--line-2)" interval={0} tickLine={false} />
            <YAxis
              tick={{ fill: "var(--ink-3)", fontSize: 10 }}
              stroke="var(--line-2)"
              tickFormatter={(v: number) => money0(v)}
              width={44}
              domain={[floor, "auto"]}
            />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={(p: TooltipProps<number, string>) => {
                if (!p.active || !p.payload?.length) return null;
                const s = p.payload[0]!.payload as Step;
                return (
                  <ChartTooltip>
                    <div className="mb-0.5 font-medium text-ink">{s.name}</div>
                    <div className="tabular-nums text-ink">{s.total ? "" : "− "}{money2(s.value)} SAR</div>
                    <div className="text-ink-3">{r.netRevenue > 0 ? pct1(s.value / r.netRevenue) : "—"} of net revenue</div>
                  </ChartTooltip>
                );
              }}
            />
            <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
            <Bar dataKey="value" stackId="w" isAnimationActive={false} radius={[2, 2, 0, 0]}>
              {steps.map((s) => (
                <Cell key={s.name} fill={s.color} />
              ))}
              <LabelList
                dataKey="value"
                position="top"
                formatter={(v: number) => money2(v)}
                style={{ fill: "var(--ink-2)", fontSize: 10, fontVariantNumeric: "tabular-nums" }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </SectionCard>
  );
}
