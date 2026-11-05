"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { axisPosition, niceAxis } from "@/price-structure/engine/scale";
import { roas2, roasX } from "@/price-structure/format";
import { SectionCard } from "../section-card";

export interface LadderMark {
  key: string;
  label: string;
  value: number;
  color: string;
}

interface Placed extends LadderMark {
  x: number;
  /** 0 = nearest the track; negative rows sit above, positive below. */
  row: number;
}

const LABEL_GAP = 10;
const CHAR_W = 6.2;

/**
 * The ROAS ladder (brief §6.4): a horizontal track (×) with marks — Target A
 * (amber), Target B (green), Baked-in (brand), and on the Actual page the
 * plan mix, actual and Meta-reported ROAS. Left of target A is shaded red.
 * Labels alternate above and below the track and climb to extra rows when
 * they would overlap. Marks that are infinite or ≤ 0 are listed underneath.
 */
export function RoasLadder({ title, subtitle, actions, marks, targetA }: { title: string; subtitle: string; actions?: React.ReactNode; marks: readonly LadderMark[]; targetA: number | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const drawable = marks.filter((m) => Number.isFinite(m.value) && m.value > 0);
  const unreachable = marks.filter((m) => !(Number.isFinite(m.value) && m.value > 0));
  const axis = useMemo(() => niceAxis([0, ...drawable.map((m) => m.value)]), [drawable]);

  const placed = useMemo<Placed[]>(() => {
    const sorted = [...drawable].sort((a, b) => a.value - b.value);
    const rows = new Map<number, number>(); // row → right edge (px) of its last label
    return sorted.map((m) => {
      const x = axisPosition(axis, m.value) * width;
      const text = `${m.label} ${roas2(m.value)}`;
      const w = text.length * CHAR_W + 8;
      const start = Math.max(0, Math.min(width - w, x - w / 2));
      // Try rows nearest the track first: above, below, above+1, below+1, …
      for (const row of [-1, 1, -2, 2, -3, 3]) {
        const end = rows.get(row) ?? -Infinity;
        if (start >= end + LABEL_GAP) {
          rows.set(row, start + w);
          return { ...m, x, row };
        }
      }
      return { ...m, x, row: 3 };
    });
  }, [drawable, axis, width]);

  const above = Math.max(0, ...placed.map((p) => -p.row));
  const below = Math.max(0, ...placed.map((p) => p.row));
  const ROW_H = 18;
  const trackTop = above * ROW_H + 4;
  const height = trackTop + 10 + below * ROW_H + 24;
  const aX = targetA !== null && Number.isFinite(targetA) && targetA > 0 ? axisPosition(axis, targetA) * width : 0;

  return (
    <SectionCard title={title} subtitle={subtitle} actions={actions}>
      <div ref={ref} className="relative w-full" style={{ height }} role="img" aria-label={marks.map((m) => `${m.label} ${roasX(m.value)}`).join(", ")}>
        {/* The track */}
        <div className="absolute left-0 right-0 h-2 rounded-full bg-surface-2" style={{ top: trackTop }}>
          {aX > 0 && <div className="absolute inset-y-0 left-0 rounded-l-full bg-neg/30" style={{ width: aX }} title="Below target A" />}
        </div>
        {/* Axis ticks */}
        {axis.ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2 text-[10px] text-ink-3 num tabular-nums" style={{ left: axisPosition(axis, t) * width, top: trackTop + 12 + below * ROW_H }}>
            {roasX(t)}
          </span>
        ))}
        {/* Marks */}
        {placed.map((m) => {
          const labelTop = m.row < 0 ? trackTop - 4 - -m.row * ROW_H : trackTop + 12 + (m.row - 1) * ROW_H;
          const lineTop = m.row < 0 ? labelTop + ROW_H - 4 : trackTop + 8;
          const lineH = m.row < 0 ? trackTop - lineTop : labelTop - lineTop;
          return (
            <div key={m.key}>
              <span className="absolute w-0.5 rounded-full" style={{ left: m.x - 1, top: lineTop, height: Math.max(0, lineH), background: m.color }} />
              <span className="absolute size-3 -translate-x-1/2 rounded-full border-2 border-surface" style={{ left: m.x, top: trackTop - 2, background: m.color }} />
              <span
                className={cn("absolute whitespace-nowrap text-[11px] num tabular-nums", "-translate-x-1/2")}
                style={{ left: Math.max(40, Math.min(width - 40, m.x)), top: labelTop, color: m.color }}
                title={`${m.label} ${roasX(m.value)}`}
              >
                {m.label} {roas2(m.value)}
              </span>
            </div>
          );
        })}
      </div>
      {unreachable.length > 0 && (
        <p className="mt-2 text-[11px] text-ink-3">Out of reach with this mix: {unreachable.map((m) => m.label).join(", ")}</p>
      )}
    </SectionCard>
  );
}
