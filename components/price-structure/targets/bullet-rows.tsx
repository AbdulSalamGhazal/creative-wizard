"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { OfferRow } from "@/price-structure/engine/all-offers";
import { METRICS, metricValue, statusAgainst } from "@/price-structure/engine/metrics";
import { axisPosition, niceAxis } from "@/price-structure/engine/scale";
import type { Target } from "@/price-structure/engine/types";
import { formatMetric } from "@/price-structure/format";
import { productColor } from "../palette";
import { StatusBadge } from "../status-badge";

/**
 * "Distance to target" (brief §6.3): a bullet row per offer — three zones
 * (miss · between A and B · past B), the offer's value as a bar from zero in
 * its product colour, tick marks at A and B, the value and a status badge.
 */
export function BulletRows({ rows, target }: { rows: readonly OfferRow[]; target: Target }) {
  const meta = METRICS[target.metric];
  const values = rows.map((r) => metricValue(r.r, target.metric));
  const axis = useMemo(() => niceAxis([0, target.a, target.b, ...values]), [target.a, target.b, values]);
  const pos = (v: number) => axisPosition(axis, v) * 100;
  const zero = pos(0);
  const [lowTick, highTick] = meta.higherIsBetter ? [target.a, target.b] : [target.b, target.a];
  // Zones: higher-is-better → red below the lower tick, amber between, green past B.
  const zones = meta.higherIsBetter
    ? [
        { from: 0, to: pos(lowTick), cls: "bg-neg/15" },
        { from: pos(lowTick), to: pos(highTick), cls: "bg-warn/20" },
        { from: pos(highTick), to: 100, cls: "bg-pos/15" },
      ]
    : [
        { from: 0, to: pos(lowTick), cls: "bg-pos/15" },
        { from: pos(lowTick), to: pos(highTick), cls: "bg-warn/20" },
        { from: pos(highTick), to: 100, cls: "bg-neg/15" },
      ];
  const fmt = (v: number) => formatMetric(target.metric, v);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2.5">
        <div className="w-28 shrink-0 sm:w-48" />
        <div className="relative h-4 flex-1 text-[10px] text-ink-3 num tabular-nums">
          {/* A phone's track is too short for every tick: show every other one. */}
          {axis.ticks.map((t, i) => (
            <span key={t} className={cn("absolute -translate-x-1/2", i % 2 === 1 && "max-sm:hidden")} style={{ left: `${pos(t)}%` }}>
              {fmt(t)}
            </span>
          ))}
        </div>
        <div className="w-24 shrink-0 sm:w-32" />
      </div>
      {rows.map((row, i) => {
        const value = values[i]!;
        const status = statusAgainst(row.r, target);
        const end = pos(value);
        const left = Math.min(zero, end);
        const width = Math.abs(end - zero);
        return (
          <div key={row.offer.id} className="flex items-center gap-2.5">
            <div className="w-28 shrink-0 truncate text-right text-[11px] text-ink-2 sm:w-48" dir="auto" title={`${row.offer.name} · ${row.product.name}`}>
              {row.offer.name} <span className="text-ink-3">· {row.product.name}</span>
            </div>
            <div className="relative h-5 flex-1 overflow-hidden rounded-md" role="img" aria-label={`${row.offer.name}: ${fmt(value)}, ${status === "b" ? "past B" : status === "a" ? "between A and B" : "misses A"}`}>
              {zones.map((z, k) => (
                <span key={k} className={cn("absolute inset-y-0", z.cls)} style={{ left: `${z.from}%`, width: `${Math.max(0, z.to - z.from)}%` }} />
              ))}
              <span className="absolute top-1/2 h-2 -translate-y-1/2 rounded-sm" style={{ left: `${left}%`, width: `${width}%`, background: productColor(row.product.colorSlot) }} />
              {[target.a, target.b].map((t, k) => (
                <span key={k} className="absolute inset-y-0 w-px bg-ink/70" style={{ left: `${pos(t)}%` }} title={`${k === 0 ? "A" : "B"} ${fmt(t)}`} />
              ))}
            </div>
            <div className="flex w-24 shrink-0 items-center justify-end gap-1.5 sm:w-32">
              <span className={cn("num tabular-nums text-[11px]", Number.isFinite(value) && value < 0 ? "text-neg" : "text-ink")}>{fmt(value)}</span>
              <StatusBadge status={status} compact />
            </div>
          </div>
        );
      })}
    </div>
  );
}
