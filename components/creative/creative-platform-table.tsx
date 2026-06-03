import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { int, pct, ratio, usd } from "@/lib/format";
import type { PlatformMixRow } from "@/db/queries/performance";

interface Props {
  rows: Array<
    PlatformMixRow & {
      clicks: number;
      ctr: number | null;
      cpa: number | null;
      roas: number | null;
      cvr: number | null;
    }
  >;
}

export function CreativePlatformTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center text-ink-3 text-sm">
        No platform activity for this creative.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm num">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink-3 border-b border-line">
            <th className="font-medium px-3 py-2.5">Platform</th>
            <th className="font-medium px-3 py-2.5 text-right">Spend</th>
            <th className="font-medium px-3 py-2.5 text-right">Impressions</th>
            <th className="font-medium px-3 py-2.5 text-right">Clicks</th>
            <th className="font-medium px-3 py-2.5 text-right">CTR</th>
            <th className="font-medium px-3 py-2.5 text-right">Conv.</th>
            <th className="font-medium px-3 py-2.5 text-right">CvR</th>
            <th className="font-medium px-3 py-2.5 text-right">CPA</th>
            <th className="font-medium px-3 py-2.5 text-right">ROAS</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.platform} className="hover:bg-surface-2/60 transition-colors">
              <td className="px-3 py-2.5">
                <span className="inline-flex items-center gap-2 text-ink">
                  <span
                    className="w-2 h-2 rounded-sm"
                    style={{ background: PLATFORM_COLOR[r.platform] }}
                  />
                  {PLATFORM_LABEL[r.platform]}
                </span>
              </td>
              <td className="px-3 py-2.5 text-right text-ink">{usd(r.spend)}</td>
              <td className="px-3 py-2.5 text-right text-ink-2">{int(r.impressions)}</td>
              <td className="px-3 py-2.5 text-right text-ink-2">{int(r.clicks)}</td>
              <td className="px-3 py-2.5 text-right text-ink-2">{pct(r.ctr)}</td>
              <td className="px-3 py-2.5 text-right text-ink-2">{int(r.conversions)}</td>
              <td className="px-3 py-2.5 text-right text-ink-2">{pct(r.cvr)}</td>
              <td className="px-3 py-2.5 text-right text-ink-2">{usd(r.cpa)}</td>
              <td className="px-3 py-2.5 text-right text-ink">{ratio(r.roas)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
