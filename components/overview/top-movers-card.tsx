import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeltaBadge } from "@/components/kpi/delta-badge";
import { usdCompact } from "@/lib/format";
import type { TopMoverRow } from "@/db/queries/performance";

/**
 * Creatives with the biggest spend movement vs the previous equal window —
 * "what changed most", risers and fallers together. Each links to its detail.
 */
export function TopMoversCard({ rows }: { rows: TopMoverRow[] }) {
  return (
    <Card className="bg-surface border-line h-full flex flex-col">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-sm">Top movers</CardTitle>
        <span className="text-[11px] text-ink-3 font-normal">vs previous period</span>
      </CardHeader>
      <CardContent className="flex-1">
        {rows.length === 0 ? (
          <div className="h-full min-h-[120px] flex items-center justify-center text-ink-3 text-sm">
            No spend movement in this window.
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.creativeId} className="flex items-center gap-3 py-2">
                <Link
                  href={`/creatives/${encodeURIComponent(r.name)}`}
                  className="flex-1 min-w-0 truncate text-sm text-ink hover:underline"
                  title={r.name}
                >
                  {r.name}
                </Link>
                <span className="num text-xs text-ink-2 shrink-0 w-14 text-right">
                  {usdCompact(r.currentSpend)}
                </span>
                <DeltaBadge delta={r.delta} className="shrink-0" />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
