import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { pct, usd, int } from "@/lib/format";
import type { VideoDiagnosticRow } from "@/db/queries/trends";

const STATUS_CLASS: Record<VideoDiagnosticRow["status"], string> = {
  active: "border-pos/40 text-pos bg-pos/10",
  draft: "border-line-2 text-ink-2 bg-surface-2",
  paused: "border-warn/40 text-warn bg-warn/10",
  archived: "border-line-2 text-ink-3 bg-surface-2",
};

/**
 * Per-video hook rate (3s views / impressions) and hold rate (15s / 3s).
 * A value below the portfolio median is tinted amber as a soft "watch this"
 * signal — these early-funnel rates are what decide whether a video lives.
 */
export function VideoDiagnosticsTable({
  rows,
  medianHookRate,
  medianHoldRate,
}: {
  rows: VideoDiagnosticRow[];
  medianHookRate: number | null;
  medianHoldRate: number | null;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-12 text-center">
        <p className="text-ink-2 text-sm">No video creatives in this window.</p>
      </div>
    );
  }

  const cell = (value: number | null, median: number | null) => {
    if (value === null) return <span className="text-ink-3">—</span>;
    const below = median !== null && value < median;
    return (
      <span className={below ? "text-warn" : "text-ink"}>{pct(value)}</span>
    );
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm num">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink-3 border-b border-line">
            <th className="font-medium px-3 py-2.5">Creative</th>
            <th className="font-medium px-3 py-2.5">Product</th>
            <th className="font-medium px-3 py-2.5">Status</th>
            <th className="font-medium px-3 py-2.5 text-right">Spend</th>
            <th className="font-medium px-3 py-2.5 text-right">Impressions</th>
            <th className="font-medium px-3 py-2.5 text-right">Hook rate</th>
            <th className="font-medium px-3 py-2.5 text-right">Hold rate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.creativeId} className="hover:bg-surface-2/60 transition-colors">
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
                <Badge variant="outline" className={STATUS_CLASS[r.status]}>
                  {r.status}
                </Badge>
              </td>
              <td className="px-3 py-2.5 text-right text-ink tabular-nums">{usd(r.spend)}</td>
              <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{int(r.impressions)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{cell(r.hookRate, medianHookRate)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{cell(r.holdRate, medianHoldRate)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line text-[11px] text-ink-3">
            <td className="px-3 py-2" colSpan={5}>
              Portfolio median
            </td>
            <td className="px-3 py-2 text-right tabular-nums num">{pct(medianHookRate)}</td>
            <td className="px-3 py-2 text-right tabular-nums num">{pct(medianHoldRate)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
