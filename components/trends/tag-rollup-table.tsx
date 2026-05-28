import Link from "next/link";
import { Hash } from "lucide-react";
import { DeltaBadge } from "@/components/kpi/delta-badge";
import { int, pct, ratio, usd } from "@/lib/format";
import type { TagRollupRow } from "@/db/queries/trends";

/**
 * Per-tag performance rollup. A creative contributes to every tag it
 * carries, so the spend column sums across overlapping tags by design.
 * Each tag links to the filtered Library view. Sorted by spend desc.
 */
export function TagRollupTable({ rows }: { rows: TagRollupRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-12 text-center">
        <p className="text-ink-2 text-sm">No tagged creatives in this window.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm num">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink-3 border-b border-line">
            <th className="font-medium px-3 py-2.5">Tag</th>
            <th className="font-medium px-3 py-2.5 text-right">Creatives</th>
            <th className="font-medium px-3 py-2.5 text-right">Spend</th>
            <th className="font-medium px-3 py-2.5 text-right">CTR</th>
            <th className="font-medium px-3 py-2.5 text-right">CPA</th>
            <th className="font-medium px-3 py-2.5 text-right">ROAS</th>
            <th className="font-medium px-3 py-2.5 text-right">Hook</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.tag} className="hover:bg-surface-2/60 transition-colors">
              <td className="px-3 py-2.5">
                <Link
                  href={`/creatives?tags=${encodeURIComponent(r.tag)}`}
                  className="inline-flex items-center gap-1.5 text-ink hover:text-brand transition-colors"
                >
                  <Hash className="w-3 h-3 text-ink-3" />
                  {r.tag}
                </Link>
              </td>
              <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">
                {int(r.creatives)}
              </td>
              <td className="px-3 py-2.5 text-right text-ink tabular-nums">
                <span className="inline-flex items-center gap-1.5 justify-end">
                  {usd(r.spend)}
                  <DeltaBadge delta={r.spendDelta} />
                </span>
              </td>
              <td className="px-3 py-2.5 text-right text-ink tabular-nums">{pct(r.ctr)}</td>
              <td className="px-3 py-2.5 text-right text-ink tabular-nums">{usd(r.cpa)}</td>
              <td className="px-3 py-2.5 text-right text-ink tabular-nums">
                {r.roas === null ? "—" : `${ratio(r.roas)}×`}
              </td>
              <td className="px-3 py-2.5 text-right text-ink tabular-nums">{pct(r.hookRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
