"use client";

import { useMemo, type ReactNode } from "react";
import { evaluateOffer } from "@/price-structure/engine/evaluate";
import { isRoasTargetMetric, resolveRoasTarget, roasNeeded } from "@/price-structure/engine/targets";
import type { Offer, Product, VersionData } from "@/price-structure/engine/types";
import { money2, num2, pct1, pct2, roas2, targetText } from "@/price-structure/format";
import { Num } from "../num";
import { SectionCard } from "../section-card";

/**
 * "How it's calculated" (brief §6.2): name · expression · value, one row per
 * step of the evaluation, so a number can always be traced to its inputs.
 */
export function HowCalculated({ product, offer, data }: { product: Product; offer: Offer; data: VersionData }) {
  const s = data.settings;
  const r = useMemo(() => evaluateOffer(product, offer, s), [product, offer, s]);
  const roasTarget = resolveRoasTarget(data.targets, data.roasTargetId);
  const ratePct = pct1(r.deliveryRate);

  const rows: Array<{ name: string; expr: string; value: ReactNode }> = [
    {
      name: "Customer pays",
      expr: `${r.units} unit${r.units === 1 ? "" : "s"} at list ${money2(r.listPrice)} − ${pct1(r.discount)} discount`,
      value: <Num value={r.paidGross} kind="money2" />,
    },
    {
      name: "Net revenue",
      expr: s.pricesIncludeVat ? `customer pays ÷ ${num2(1 + s.vatRate)} (VAT)` : "price excl. VAT",
      value: <Num value={r.netRevenue} kind="money2" />,
    },
    { name: "COGS", expr: `${r.units} × ${money2(product.unitCost)}`, value: <Num value={r.cogs} kind="money2" /> },
    {
      name: "Ad spend / placed order",
      expr: offer.adMode === "cpa" ? `CPA $${num2(offer.cpaUsd)} × ${num2(s.usdToSar)}` : `customer pays ÷ ROAS ${roas2(offer.platformRoas)}`,
      value: <Num value={r.adSpend} kind="money2" />,
    },
    { name: "Marketing / delivered", expr: `ad spend ÷ ${ratePct} delivered`, value: <Num value={r.marketing} kind="money2" /> },
    {
      name: "Undelivered cost",
      expr: `(1 − ${ratePct}) ÷ ${ratePct} × ${money2(s.undeliveredCost)}`,
      value: <Num value={r.undelivered} kind="money2" />,
    },
    { name: "CML", expr: "net revenue − COGS − marketing − undelivered", value: <Num value={r.profit} kind="money2" /> },
    { name: "CML %", expr: "CML ÷ net revenue", value: <Num value={r.margin} kind="pct2" /> },
    { name: "Platform ROAS", expr: "customer pays ÷ ad spend", value: <Num value={r.platformRoas} kind="roas" /> },
    { name: "Accountant ROAS", expr: "net revenue ÷ (marketing + undelivered)", value: <Num value={r.accountantRoas} kind="roas" /> },
  ];

  if (roasTarget && isRoasTargetMetric(roasTarget.metric)) {
    const kept = (v: number) =>
      roasTarget.metric === "margin" ? `${pct1(v)} × net revenue` : roasTarget.metric === "profitPerUnit" ? `${r.units} × ${money2(v)}` : money2(v);
    for (const level of ["a", "b"] as const) {
      const v = roasTarget[level];
      rows.push({
        name: `ROAS for ${level.toUpperCase()}`,
        expr: `customer pays ÷ (delivery rate × (net revenue − COGS − undelivered − ${kept(v)}))`,
        value: (
          <span title={`Platform ROAS needed for ${targetText(roasTarget.metric, v)}`}>
            <Num value={roasNeeded(r, roasTarget.metric, v, s.usdToSar).roas} kind="roas" />
          </span>
        ),
      });
    }
  }

  return (
    <SectionCard title="How it's calculated" subtitle={`${pct2(r.margin)} CML on this offer`}>
      <dl className="divide-y divide-line text-xs">
        {rows.map((row) => (
          <div key={row.name} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-baseline gap-x-3 py-1.5">
            <dt className="text-ink-2">{row.name}</dt>
            <dd className="min-w-0 break-words text-ink-3 num tabular-nums">{row.expr}</dd>
            <dd className="text-right text-ink">{row.value}</dd>
          </div>
        ))}
      </dl>
    </SectionCard>
  );
}
