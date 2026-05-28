import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DeltaBadge } from "@/components/kpi/delta-badge";
import { usd } from "@/lib/format";
import type { TopMoverRow } from "@/db/queries/performance";

interface Props {
  rows: TopMoverRow[];
}

const statusClass: Record<TopMoverRow["status"], string> = {
  active: "border-pos/40 text-pos bg-pos/10",
  draft: "border-line-2 text-ink-2 bg-surface-2",
  paused: "border-warn/40 text-warn bg-warn/10",
  archived: "border-line-2 text-ink-3 bg-surface-2",
};

/**
 * "What's moving" — creatives sorted by the absolute dollar swing in spend
 * between the current and prior periods. The dollar Δ is shown alongside
 * the percent so a big-dollar move on a small-percent base still ranks.
 */
export function TopMoversTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-12 text-center">
        <p className="text-ink-2 text-sm">
          No creatives moved between the two windows.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm num">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink-3 border-b border-line">
            <th className="font-medium px-3 py-2.5">Creative</th>
            <th className="font-medium px-3 py-2.5">Product</th>
            <th className="font-medium px-3 py-2.5">Status</th>
            <th className="font-medium px-3 py-2.5 text-right">Prior spend</th>
            <th className="font-medium px-3 py-2.5 text-right">Current spend</th>
            <th className="font-medium px-3 py-2.5 text-right">Δ $</th>
            <th className="font-medium px-3 py-2.5 text-right">Δ %</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => {
            const dollarDelta = r.currentSpend - r.previousSpend;
            const dollarUp = dollarDelta >= 0;
            return (
              <tr
                key={r.creativeId}
                className="hover:bg-surface-2/60 transition-colors"
              >
                <td className="px-3 py-2.5">
                  <Link
                    href={`/creatives/${encodeURIComponent(r.name)}`}
                    className="font-mono text-ink text-[13px] hover:text-brand transition-colors"
                  >
                    {r.name}
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-ink-2">{r.productName}</td>
                <td className="px-3 py-2.5">
                  <Badge variant="outline" className={statusClass[r.status]}>
                    {r.status}
                  </Badge>
                </td>
                <td className="px-3 py-2.5 text-right text-ink-2">
                  {r.previousSpend > 0 ? usd(r.previousSpend) : "—"}
                </td>
                <td className="px-3 py-2.5 text-right text-ink">
                  {r.currentSpend > 0 ? usd(r.currentSpend) : "—"}
                </td>
                <td
                  className={
                    "px-3 py-2.5 text-right tabular-nums " +
                    (dollarDelta === 0
                      ? "text-ink-3"
                      : dollarUp
                        ? "text-pos"
                        : "text-neg")
                  }
                >
                  {dollarDelta === 0
                    ? "—"
                    : `${dollarUp ? "+" : "−"}${usd(Math.abs(dollarDelta)).replace("$", "$")}`}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <DeltaBadge delta={r.delta} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
