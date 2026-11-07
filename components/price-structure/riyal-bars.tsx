"use client";

import { cn } from "@/lib/utils";
import { money0, money2, pct1 } from "@/price-structure/format";
import { PART_COLOR, PART_LABEL, PARTS, type Part } from "./palette";

export interface RiyalRow {
  key: string;
  label: string;
  sublabel?: string;
  /** A product colour dot before the label. */
  color?: string;
  /** SAR per delivered order (or per period): the four parts of net revenue. */
  parts: Record<Part, number>;
  /** Net revenue the parts add up to (CML may be negative). */
  netRevenue: number;
  emphasis?: boolean;
}

/**
 * "Where each riyal goes" (brief §6.1, §6.4): one horizontal 100%-stacked bar
 * per row made of CML, COGS, Marketing and Undelivered — or, in SAR mode,
 * absolute stacked bars on one scale. CSS, like the house rating-mix bars;
 * each segment carries its "% · SAR" as its title.
 */
export function RiyalBars({ rows, mode, className }: { rows: readonly RiyalRow[]; mode: "pct" | "sar"; className?: string }) {
  const maxSar = Math.max(1, ...rows.map((r) => Math.max(r.netRevenue, sumPositive(r.parts))));
  return (
    <div className={cn("space-y-1.5", className)}>
      {rows.map((row) => {
        const denom = mode === "pct" ? Math.max(sumPositive(row.parts), 1e-9) : maxSar;
        return (
          <div key={row.key} className="flex items-center gap-2.5">
            <div className="w-36 shrink-0 text-right text-[11px] leading-tight sm:w-44">
              <span className={cn("inline-flex max-w-full items-center justify-end gap-1.5", row.emphasis ? "font-medium text-ink" : "text-ink-2")}>
                {row.color && <span className="size-2 shrink-0 rounded-full" style={{ background: row.color }} aria-hidden />}
                <span className="truncate" dir="auto" title={row.label}>
                  {row.label}
                </span>
              </span>
              {row.sublabel && <span className="block truncate text-[10px] text-ink-2">{row.sublabel}</span>}
            </div>
            <div className={cn("flex h-6 flex-1 overflow-hidden rounded-md bg-surface-2", row.emphasis && "h-7")} role="img" aria-label={ariaOf(row)}>
              {PARTS.map((part) => {
                const sar = row.parts[part];
                if (!(sar > 0)) return null;
                const frac = sar / denom;
                const share = row.netRevenue > 0 ? sar / row.netRevenue : 0;
                return (
                  <span
                    key={part}
                    title={`${PART_LABEL[part]}: ${pct1(share)} · ${money2(sar)} SAR`}
                    className="flex items-center justify-center overflow-hidden text-[10px] font-semibold leading-none text-on-fill [text-shadow:0_1px_1.5px_rgb(0_0_0/0.4)] dark:[text-shadow:none]"
                    style={{ width: `${frac * 100}%`, background: PART_COLOR[part] }}
                  >
                    {frac >= 0.12 ? (mode === "pct" ? pct1(share) : money0(sar)) : ""}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-[11px] text-ink-3">
        {PARTS.map((part) => (
          <span key={part} className="inline-flex items-center gap-1">
            <span className="size-2 rounded-sm" style={{ background: PART_COLOR[part] }} aria-hidden />
            {PART_LABEL[part]}
          </span>
        ))}
      </div>
    </div>
  );
}

function sumPositive(parts: Record<Part, number>): number {
  return PARTS.reduce((s, p) => s + Math.max(0, parts[p]), 0);
}

function ariaOf(row: RiyalRow): string {
  return `${row.label}: ${PARTS.map((p) => `${PART_LABEL[p]} ${pct1(row.netRevenue > 0 ? row.parts[p] / row.netRevenue : 0)}`).join(", ")}`;
}
