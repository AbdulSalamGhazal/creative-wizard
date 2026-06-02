import { DeltaBadge } from "@/components/kpi/delta-badge";
import { int, pct, usd } from "@/lib/format";
import type { CampaignFunnelRow } from "@/db/queries/funnel";

/**
 * Per-campaign funnel table. One row per stored campaign_name (the full
 * "Campaign ➤ Adset" value), sorted by spend. CPM/CTR/VOC/CvR read the funnel;
 * the spend Δ flags movers vs the prior equal-length window. Sticky header +
 * internal scroll for long lists.
 */
export function CampaignFunnelTable({ rows }: { rows: CampaignFunnelRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-12 text-center">
        <p className="text-ink-2 text-sm">No campaign activity in this window.</p>
      </div>
    );
  }

  return (
    <div className="max-h-[60vh] overflow-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm num">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink-3 [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:bg-surface [&>th]:border-b [&>th]:border-line">
            <th className="font-medium px-3 py-2.5">Campaign</th>
            <th className="font-medium px-3 py-2.5 text-right">Spend</th>
            <th className="font-medium px-3 py-2.5 text-right">CPM</th>
            <th className="font-medium px-3 py-2.5 text-right">CTR</th>
            <th className="font-medium px-3 py-2.5 text-right">VOC</th>
            <th className="font-medium px-3 py-2.5 text-right">CvR</th>
            <th className="font-medium px-3 py-2.5 text-right">Conv.</th>
            <th className="font-medium px-3 py-2.5 text-right">Impr.</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.campaign} className="hover:bg-surface-2/60 transition-colors">
              <td className="px-3 py-2.5 max-w-[22rem]">
                <span className="block truncate text-ink" title={r.campaign}>
                  {r.campaign}
                </span>
              </td>
              <td className="px-3 py-2.5 text-right text-ink tabular-nums">
                <span className="inline-flex items-center gap-1.5 justify-end">
                  {usd(r.spend)}
                  <DeltaBadge delta={r.spendDelta} />
                </span>
              </td>
              <td className="px-3 py-2.5 text-right text-ink tabular-nums">{usd(r.cpm)}</td>
              <td className="px-3 py-2.5 text-right text-ink tabular-nums">{pct(r.ctr)}</td>
              <td className="px-3 py-2.5 text-right text-ink tabular-nums">{pct(r.voc)}</td>
              <td className="px-3 py-2.5 text-right text-ink tabular-nums">{pct(r.cvr)}</td>
              <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{int(r.conversions)}</td>
              <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{int(r.impressions)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
