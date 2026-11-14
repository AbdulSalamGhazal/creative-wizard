"use client";

import { PlatformDot } from "@/components/ui/platform-dot";
import { panelClass } from "@/components/ui/panel";
import { PLATFORM_COLOR } from "@/lib/palette";
import { cn } from "@/lib/utils";
import { pacingVerdict, type RangePlatform } from "@/lib/budget";
import { PacingDevCell } from "@/components/budget/budget-shared";

const W = 160;
const H = 44;

function cumulative(values: readonly number[]): number[] {
  let run = 0;
  return values.map((v) => (run += v));
}

function path(points: readonly number[], total: number, max: number): string {
  if (points.length === 0 || max <= 0) return "";
  const step = total > 1 ? W / (total - 1) : 0;
  return points
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(H - (v / max) * H).toFixed(1)}`)
    .join(" ");
}

/**
 * One small chart per platform: cumulative spend (the platform's colour,
 * through its own covered day) over the cumulative plan (a quiet dashed
 * line), all on their OWN scale — the shape is the reading, the amounts are
 * printed. Five lines on one axis hide the small platforms; five small
 * charts don't. Spend only: revenue has no platform attribution.
 */
export function PlatformMultiples({
  rows,
  label,
  fmt,
}: {
  rows: readonly RangePlatform[];
  label: (platform: string) => string;
  fmt: (usd: number) => string;
}) {
  const shown = rows.filter((r) => r.plan > 0 || r.actual > 0);
  if (shown.length < 2) return null;
  return (
    <section aria-labelledby="platform-multiples">
      <h2 id="platform-multiples" className="mb-2 text-sm font-medium text-ink">
        Each platform&rsquo;s pace
      </h2>
      <div className="grid grid-cols-2 gap-2 @2xl/main:grid-cols-3 @4xl/main:grid-cols-5">
        {shown.map((r) => {
          const plan = cumulative(r.daily.plan);
          const actual = cumulative(r.daily.actual);
          const max = Math.max(plan.at(-1) ?? 0, actual.at(-1) ?? 0);
          const name = label(r.key);
          const color =
            r.key in PLATFORM_COLOR ? PLATFORM_COLOR[r.key as keyof typeof PLATFORM_COLOR] : "var(--ink-2)";
          return (
            <figure
              key={r.key}
              className={cn(panelClass({ padding: "sm" }), "m-0")}
              aria-label={`${name}: ${fmt(r.actual)} spent${r.plan > 0 ? ` of ${fmt(r.plan)} planned, ${pacingVerdict(r.deviation)}` : ", no plan"}`}
            >
              <figcaption className="flex items-center justify-between gap-2 text-xs text-ink-2">
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <PlatformDot platform={r.key} />
                  <span className="truncate">{name}</span>
                </span>
                {r.plan > 0 && <PacingDevCell deviation={r.deviation} />}
              </figcaption>
              <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-11 w-full" preserveAspectRatio="none" aria-hidden="true">
                <path d={path(plan, plan.length, max)} fill="none" stroke="var(--ink-3)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                <path d={path(actual, plan.length, max)} fill="none" stroke={color} strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
              </svg>
              <p className="mt-1 text-xs tabular-nums text-ink-2">
                <span className="text-ink">{fmt(r.actual)}</span>
                {r.plan > 0 && <> of {fmt(r.plan)}</>}
              </p>
            </figure>
          );
        })}
      </div>
    </section>
  );
}
