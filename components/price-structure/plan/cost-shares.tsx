"use client";

import type { Blend } from "@/price-structure/engine/blend";
import { money0, pct2 } from "@/price-structure/format";
import { PART_COLOR } from "../palette";
import { SectionCard } from "../section-card";

interface Column {
  label: string;
  blend: Blend;
  /** Multiplier for the SAR column (period days, or the day/week/month factor). */
  mult: number;
}

/**
 * "Cost shares" (brief §6.4): the blended cost structure as a share of net
 * revenue — Net revenue 100%, COGS, Marketing, Undelivered, CML — with a SAR
 * column per blend. Plan mode shows one blend; the Actual page shows
 * "Actual" beside "At baked-in ROAS".
 */
export function CostShares({ title = "Cost shares", subtitle, columns, sarLabel }: { title?: string; subtitle: string; columns: readonly Column[]; sarLabel: string }) {
  const rows = [
    { key: "net", label: "Net revenue", color: null, pct: () => 1, sar: (b: Blend) => b.netRevenue },
    { key: "cogs", label: "COGS", color: PART_COLOR.cogs, pct: (b: Blend) => b.cogsPct, sar: (b: Blend) => b.cogs },
    { key: "marketing", label: "Marketing (ad spend)", color: PART_COLOR.marketing, pct: (b: Blend) => b.marketingPct, sar: (b: Blend) => b.adSpend },
    ...(columns.some((c) => c.blend.undelivered > 0)
      ? [{ key: "undelivered", label: "Undelivered", color: PART_COLOR.undelivered, pct: (b: Blend) => b.undeliveredPct, sar: (b: Blend) => b.undelivered }]
      : []),
    { key: "cml", label: "Clean Money Left (CML)", color: PART_COLOR.cml, pct: (b: Blend) => b.margin, sar: (b: Blend) => b.profit, bold: true },
  ];
  const gridCols = `minmax(0,1fr) ${columns.map(() => "auto auto").join(" ")}`;
  return (
    <SectionCard title={title} subtitle={subtitle} contentClassName="overflow-x-auto">
      {/* Two blends are five columns: on a phone the grid scrolls inside the card. */}
      <div className={columns.length > 1 ? "min-w-[30rem]" : "min-w-[18rem]"}>
      <div className="grid gap-x-4 gap-y-1.5 text-xs" style={{ gridTemplateColumns: gridCols }} role="table">
        <div role="row" className="contents text-label text-ink-3">
          <span role="columnheader" />
          {columns.map((c) => (
            <span key={c.label} className="contents">
              <span role="columnheader" className="text-right">{c.label} %</span>
              <span role="columnheader" className="text-right">{sarLabel}</span>
            </span>
          ))}
        </div>
        {rows.map((r) => (
          <div key={r.key} role="row" className="contents">
            <span role="cell" className={"bold" in r && r.bold ? "font-medium text-ink" : "text-ink-2"}>
              <span className="inline-flex items-center gap-1.5">
                {r.color ? <span className="size-2 rounded-sm" style={{ background: r.color }} aria-hidden /> : <span className="size-2" aria-hidden />}
                {r.label}
              </span>
            </span>
            {columns.map((c) => {
              const pct = r.pct(c.blend);
              const sar = r.sar(c.blend) * c.mult;
              const neg = Number.isFinite(sar) && sar < 0;
              return (
                <span key={c.label} className="contents">
                  <span role="cell" className={`text-right tabular-nums ${neg ? "text-neg" : "text-ink"}`}>{pct2(pct)}</span>
                  <span role="cell" className={`text-right tabular-nums ${neg ? "text-neg" : "text-ink"}`}>{money0(sar)}</span>
                </span>
              );
            })}
          </div>
        ))}
      </div>
      </div>
    </SectionCard>
  );
}
