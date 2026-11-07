"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { blend, type Blend, type Line } from "@/price-structure/engine/blend";
import { copyMixFromPeriod, evenShares, normaliseShares, offerShareSum, productShareSum, sharesOff, SHARE_TOLERANCE } from "@/price-structure/engine/shares";
import type { ActualPeriod, Plan, Product, Settings } from "@/price-structure/engine/types";
import { num2, pct1, roas2 } from "@/price-structure/format";
import { NumberField } from "../fields";
import { productColor } from "../palette";
import { SectionCard } from "../section-card";

/**
 * "Sales mix" (brief §6.4): the product mix bar, the "shares don't add up"
 * note with Make them 100%, the editable share table (product share of all
 * orders, each offer's share within its product), Even split and "Copy mix &
 * volume from…" a period. An EDITOR grid, hand-rolled by decision (D22).
 */
export function SalesMix({
  plan,
  products,
  settings,
  lines,
  total,
  actuals,
  mult,
  perLabel,
  onChange,
  readOnly = false,
}: {
  plan: Plan;
  products: readonly Product[];
  settings: Settings;
  lines: readonly Line[];
  total: Blend;
  actuals: readonly ActualPeriod[];
  mult: number;
  perLabel: string;
  onChange: (fn: (p: Plan) => Plan) => void;
  readOnly?: boolean;
}) {
  const [copyFrom, setCopyFrom] = useState("");
  const P = productShareSum(plan, products);
  const off = sharesOff(plan, products);
  const pShare = (p: Product) => (P > 0 ? Math.max(0, plan.productShare[p.id] ?? 0) / P : 0);
  const setProductShare = (id: string, v: number) => onChange((pl) => ({ ...pl, productShare: { ...pl.productShare, [id]: v } }));
  const setOfferShare = (id: string, v: number) => onChange((pl) => ({ ...pl, offerShare: { ...pl.offerShare, [id]: v } }));

  const productBlend = (p: Product) => blend(lines.filter((l) => l.product.id === p.id), settings);
  const row = "grid grid-cols-[minmax(0,1fr)_5.5rem_4.5rem_5rem_4.5rem] items-center gap-2 px-2 py-1 text-xs";

  return (
    <SectionCard
      title="Sales mix"
      subtitle="Share of orders per product, then each offer's share within its product."
      actions={
        readOnly ? undefined : (
        <>
          <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => onChange((pl) => ({ ...pl, ...evenShares(products) }))}>
            Even split
          </Button>
          {actuals.length > 0 && (
            <Select
              value={copyFrom}
              onValueChange={(id) => {
                setCopyFrom("");
                const period = actuals.find((a) => a.id === id);
                if (period) onChange((pl) => copyMixFromPeriod(pl, period, products));
              }}
            >
              <SelectTrigger size="sm" className="h-8 text-xs" aria-label="Copy mix and volume from a period">
                <SelectValue placeholder="Copy mix & volume from…" />
              </SelectTrigger>
              <SelectContent align="end">
                {actuals.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </>
        )
      }
      contentClassName="space-y-3"
    >
      <fieldset disabled={readOnly} className="min-w-0 space-y-3">
      {/* Mix bar */}
      <div className="flex h-5 w-full overflow-hidden rounded-md bg-surface-2" role="img" aria-label={products.map((p) => `${p.name} ${pct1(pShare(p))}`).join(", ")}>
        {products.map((p) => {
          const share = pShare(p);
          if (share <= 0) return null;
          return (
            <span
              key={p.id}
              title={`${p.name}: ${pct1(share)}`}
              className="flex items-center justify-center overflow-hidden text-[10px] font-semibold text-on-fill"
              style={{ width: `${share * 100}%`, background: productColor(p.colorSlot) }}
            >
              {share >= 0.1 ? pct1(share) : ""}
            </span>
          );
        })}
      </div>
      {off && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warn/40 bg-warn/10 px-2 py-1.5 text-[11px] text-ink-2">
          Some shares don&apos;t add up to 100%. Results scale them to 100% for you.
          {!readOnly && (
            <Button type="button" size="xs" variant="outline" onClick={() => onChange((pl) => normaliseShares(pl, products))}>
              Make them 100%
            </Button>
          )}
        </div>
      )}
      <div className="overflow-x-auto rounded-md border border-line">
        <div className="min-w-[520px]">
          <div className={cn(row, "border-b border-line bg-surface-2/40 text-[10px] uppercase tracking-wide text-ink-3")}>
            <span>Product / offer</span>
            <span className="text-right">Share %</span>
            <span className="text-right">Of all orders</span>
            <span className="text-right">Orders {perLabel}</span>
            <span className="text-right">ROAS</span>
          </div>
          {products.map((p) => {
            const O = offerShareSum(plan, p);
            const offersOff = p.offers.length > 0 && Math.abs(O - 1) > SHARE_TOLERANCE;
            const pb = productBlend(p);
            const share = pShare(p);
            return (
              <div key={p.id} className="border-b border-line last:border-b-0">
                <div className={cn(row, "bg-surface-2/20")}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: productColor(p.colorSlot) }} aria-hidden />
                    <span className="truncate font-medium text-ink" dir="auto">{p.name}</span>
                    {offersOff && (
                      <span className="shrink-0 rounded-sm border border-warn/50 px-1 text-[10px] text-warn tabular-nums" title="This product's offer shares are scaled to 100%">
                        offers add to {pct1(O)}
                      </span>
                    )}
                  </span>
                  <NumberField value={plan.productShare[p.id] ?? 0} pct unit="%" min={0} size="xs" ariaLabel={`${p.name} share`} onChange={(v) => setProductShare(p.id, v)} />
                  <span className="text-right tabular-nums text-ink-2">{pct1(share)}</span>
                  <span className="text-right tabular-nums text-ink">{num2(plan.ordersPerDay * share * mult)}</span>
                  <span className="text-right tabular-nums text-ink">{pb.orders > 0 ? roas2(pb.platformRoas) : "—"}</span>
                </div>
                {p.offers.map((o) => {
                  const line = lines.find((l) => l.offer.id === o.id);
                  const within = O > 0 ? Math.max(0, plan.offerShare[o.id] ?? 0) / O : 0;
                  return (
                    <div key={o.id} className={row}>
                      <span className="truncate pl-6 text-ink-2" dir="auto">{o.name}</span>
                      <NumberField value={plan.offerShare[o.id] ?? 0} pct unit="%" min={0} size="xs" ariaLabel={`${o.name} share within ${p.name}`} onChange={(v) => setOfferShare(o.id, v)} />
                      <span className="text-right tabular-nums text-ink-3">{pct1(share * within)}</span>
                      <span className="text-right tabular-nums text-ink-2">{num2((line?.orders ?? 0) * mult)}</span>
                      <span className="text-right tabular-nums text-ink-2">{line ? roas2(line.r.platformRoas) : "—"}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
          <div className={cn(row, "border-t border-line bg-surface-2/40 font-medium")}>
            <span>Total</span>
            <span className={cn("text-right tabular-nums", Math.abs(P - 1) > SHARE_TOLERANCE ? "text-neg" : "text-ink")}>{pct1(P)}</span>
            <span className="text-right tabular-nums text-ink">100%</span>
            <span className="text-right tabular-nums text-ink">{num2(total.orders * mult)}</span>
            <span className="text-right tabular-nums text-ink">{total.orders > 0 ? roas2(total.platformRoas) : "—"}</span>
          </div>
        </div>
      </div>
      </fieldset>
    </SectionCard>
  );
}
