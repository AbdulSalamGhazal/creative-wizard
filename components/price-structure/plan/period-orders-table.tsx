"use client";

import { cn } from "@/lib/utils";
import type { Blend, Line } from "@/price-structure/engine/blend";
import { periodTotalOrders } from "@/price-structure/engine/blend";
import { orderKey, type ActualPeriod, type Product } from "@/price-structure/engine/types";
import { int0, num2, pct1, roas2 } from "@/price-structure/format";
import { NumberField } from "../fields";
import { productColor } from "../palette";
import { SectionCard } from "../section-card";

/**
 * "Orders in this period" (brief §6.4): product header rows, then an
 * editable Orders cell per offer with per day, share and the offer's
 * baked-in ROAS. An EDITOR grid, hand-rolled by decision (D22).
 */
export function PeriodOrdersTable({ period, products, lines, baked, onChange }: { period: ActualPeriod; products: readonly Product[]; lines: readonly Line[]; baked: Blend; onChange: (fn: (p: ActualPeriod) => ActualPeriod) => void }) {
  const days = Math.max(1, period.days);
  const total = periodTotalOrders(period);
  const row = "grid grid-cols-[minmax(0,1fr)_6rem_5rem_4.5rem_5.5rem] items-center gap-2 px-2 py-1 text-xs";
  const setOrders = (key: string, n: number) => onChange((p) => ({ ...p, orders: { ...p.orders, [key]: n } }));
  return (
    <SectionCard title="Orders in this period" subtitle="Placed orders per offer, for the whole period." contentClassName="px-0">
      <div className="overflow-x-auto">
        <div className="min-w-[520px]">
          <div className={cn(row, "border-y border-line bg-surface-2/40 text-[10px] uppercase tracking-wide text-ink-3")}>
            <span>Product / offer</span>
            <span className="text-right">Orders</span>
            <span className="text-right">Per day</span>
            <span className="text-right">Share</span>
            <span className="text-right">Baked-in ROAS</span>
          </div>
          {products.map((p) => (
            <div key={p.id} className="border-b border-line">
              <div className={cn(row, "bg-surface-2/20")}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: productColor(p.colorSlot) }} aria-hidden />
                  <span className="truncate font-medium text-ink" dir="auto">{p.name}</span>
                </span>
                <span className="col-span-4" />
              </div>
              {p.offers.map((o) => {
                const key = orderKey(p.id, o.id);
                const n = Math.max(0, period.orders[key] ?? 0);
                const line = lines.find((l) => l.offer.id === o.id);
                return (
                  <div key={o.id} className={row}>
                    <span className="truncate pl-6 text-ink-2" dir="auto">{o.name}</span>
                    <NumberField value={n} integer min={0} size="xs" ariaLabel={`${p.name} · ${o.name} orders`} onChange={(v) => setOrders(key, v)} />
                    <span className="text-right tabular-nums text-ink-2">{num2(n / days)}</span>
                    <span className="text-right tabular-nums text-ink-3">{pct1(total > 0 ? n / total : 0)}</span>
                    <span className="text-right tabular-nums text-ink-2">{line ? roas2(line.r.platformRoas) : "—"}</span>
                  </div>
                );
              })}
            </div>
          ))}
          <div className={cn(row, "bg-surface-2/40 font-medium")}>
            <span>Total</span>
            <span className="text-right tabular-nums text-ink">{int0(total)}</span>
            <span className="text-right tabular-nums text-ink">{num2(total / days)}</span>
            <span className="text-right tabular-nums text-ink">100%</span>
            <span className="text-right tabular-nums text-ink">{baked.orders > 0 ? roas2(baked.platformRoas) : "—"}</span>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
