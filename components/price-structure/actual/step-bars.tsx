"use client";

import { money0 } from "@/price-structure/format";
import { cn } from "@/lib/utils";

export interface StepBar {
  key: string;
  label: string;
  /** A total is drawn from zero and sets the running figure; a step moves it. */
  kind: "total" | "step";
  value: number;
  color?: string;
  /** The row's ⓘ-style explanation, on hover. */
  title?: string;
  strong?: boolean;
}

/**
 * A waterfall as rows — the label, a bar from where the running figure was
 * to where this row leaves it, the amount. CSS only, like the house riyal
 * bars; every bar is on one scale so lengths compare. `signed` prints a "+"
 * on a positive step (the plan → actual bridge).
 */
export function StepBars({ bars, signed = false }: { bars: readonly StepBar[]; signed?: boolean }) {
  let running = 0;
  const spans = bars.map((b) => {
    const start = b.kind === "total" ? 0 : running;
    const end = b.kind === "total" ? b.value : running + b.value;
    running = end;
    return { b, lo: Math.min(start, end), hi: Math.max(start, end) };
  });
  const min = Math.min(0, ...spans.map((s) => s.lo));
  const max = Math.max(0, ...spans.map((s) => s.hi));
  const width = max - min || 1;
  const pct = (x: number) => ((x - min) / width) * 100;

  return (
    <ul className="space-y-1.5" aria-label="Waterfall">
      {spans.map(({ b, lo, hi }) => (
        <li
          key={b.key}
          className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm @md/main:grid-cols-[11rem_minmax(0,1fr)_7rem]"
          title={b.title}
        >
          <span className={cn("truncate", b.strong ? "font-medium" : "text-ink-2")}>{b.label}</span>
          <span className="relative h-3.5 rounded-sm bg-surface-2/60" aria-hidden>
            <span
              className="absolute inset-y-0 rounded-sm"
              style={{
                left: `${pct(lo)}%`,
                width: `${Math.max(0.5, pct(hi) - pct(lo))}%`,
                background: b.color ?? "var(--ink-3)",
                opacity: b.kind === "total" && !b.color ? 0.45 : 0.85,
              }}
            />
          </span>
          <span className={cn("text-right tabular-nums", b.strong && "font-medium")}>
            {signed && b.kind === "step" && b.value > 0 ? "+" : ""}
            {money0(b.value)}
          </span>
        </li>
      ))}
    </ul>
  );
}
