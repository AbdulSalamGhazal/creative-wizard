import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usdCompact } from "@/lib/format";
import type { TopMoverRow } from "@/db/queries/performance";

/**
 * Spend movers as a diverging (tornado) bar chart: each creative's bar grows
 * right from center when spend rose (green) or left when it fell (red), sized
 * by the absolute change. Reads direction + magnitude at a glance.
 */
export function TopMoversChart({ rows }: { rows: TopMoverRow[] }) {
  const withDelta = rows.map((r) => ({ ...r, abs: r.currentSpend - r.previousSpend }));
  const max = withDelta.reduce((m, r) => Math.max(m, Math.abs(r.abs)), 0);

  return (
    <Card className="bg-surface border-line h-full flex flex-col">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-sm">Top movers</CardTitle>
        <span className="text-[11px] text-ink-3 font-normal">spend Δ vs previous</span>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col">
        {withDelta.length === 0 || max === 0 ? (
          <div className="h-full min-h-[120px] flex items-center justify-center text-ink-3 text-sm">
            No spend movement in this window.
          </div>
        ) : (
          <ul className="flex-1 flex flex-col justify-between gap-1.5">
            {withDelta.map((r) => {
              const up = r.abs >= 0;
              const frac = max > 0 ? Math.abs(r.abs) / max : 0;
              return (
                <li key={r.creativeId} className="flex items-center gap-2 text-xs">
                  <Link
                    href={`/creatives/${encodeURIComponent(r.name)}`}
                    className="w-[34%] shrink-0 truncate text-ink hover:underline"
                    title={r.name}
                  >
                    {r.name}
                  </Link>
                  {/* Diverging bar */}
                  <div className="flex-1 flex items-center h-3.5">
                    <div className="w-1/2 flex justify-end">
                      {!up && (
                        <div
                          className="h-2 rounded-l-full"
                          style={{ width: `${frac * 100}%`, background: "var(--neg)" }}
                        />
                      )}
                    </div>
                    <div className="w-px self-stretch bg-line shrink-0" />
                    <div className="w-1/2 flex justify-start">
                      {up && (
                        <div
                          className="h-2 rounded-r-full"
                          style={{ width: `${frac * 100}%`, background: "var(--pos)" }}
                        />
                      )}
                    </div>
                  </div>
                  <span
                    className="num shrink-0 w-16 text-right tabular-nums"
                    style={{ color: up ? "var(--pos)" : "var(--neg)" }}
                  >
                    {up ? "+" : "−"}
                    {usdCompact(Math.abs(r.abs))}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
