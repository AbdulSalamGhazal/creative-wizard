import { Badge } from "@/components/ui/badge";
import { int, usd } from "@/lib/format";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import type { CampaignRecordRow } from "@/db/queries/campaign";

/**
 * Day-level records for the campaign (one row per creative × platform × date),
 * newest first. Capped at 500 rows; excluded rows carry a badge.
 */
export function CampaignRecordsTable({ rows }: { rows: CampaignRecordRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center text-ink-3 text-sm">
        No records in this window.
      </div>
    );
  }
  return (
    <div className="max-h-[60vh] overflow-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm num">
        <thead className="sticky top-0 z-10 bg-surface">
          <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink-3 border-b border-line">
            <th className="font-medium px-3 py-2.5 bg-surface">Date</th>
            <th className="font-medium px-3 py-2.5 bg-surface">Creative</th>
            <th className="font-medium px-3 py-2.5 bg-surface">Platform</th>
            <th className="font-medium px-3 py-2.5 text-right bg-surface">Spend</th>
            <th className="font-medium px-3 py-2.5 text-right bg-surface">Impr.</th>
            <th className="font-medium px-3 py-2.5 text-right bg-surface">Clicks</th>
            <th className="font-medium px-3 py-2.5 text-right bg-surface">LP views</th>
            <th className="font-medium px-3 py-2.5 text-right bg-surface">Conv.</th>
            <th className="font-medium px-3 py-2.5 text-right bg-surface">Value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr
              key={r.id}
              className={`hover:bg-surface-2/50 transition-colors ${r.excludedFromAggregates ? "opacity-55" : ""}`}
            >
              <td className="px-3 py-2 text-ink-2 tabular-nums whitespace-nowrap">{r.date}</td>
              <td className="px-3 py-2">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="block truncate max-w-[16rem] font-mono text-[12px] text-ink-2" title={r.creativeName}>
                    {r.creativeName}
                  </span>
                  {r.excludedFromAggregates && (
                    <Badge variant="outline" className="text-[9px] border-line-2 text-ink-3">
                      excluded
                    </Badge>
                  )}
                </span>
              </td>
              <td className="px-3 py-2">
                <span className="inline-flex items-center gap-1.5 text-ink-2 whitespace-nowrap text-xs">
                  <span
                    className="w-2 h-2 rounded-sm"
                    style={{ background: PLATFORM_COLOR[r.platform] }}
                  />
                  {PLATFORM_LABEL[r.platform]}
                </span>
              </td>
              <td className="px-3 py-2 text-right text-ink tabular-nums">{usd(r.spend)}</td>
              <td className="px-3 py-2 text-right text-ink-2 tabular-nums">{int(r.impressions)}</td>
              <td className="px-3 py-2 text-right text-ink-2 tabular-nums">{int(r.clicks)}</td>
              <td className="px-3 py-2 text-right text-ink-2 tabular-nums">
                {r.landingPageViews === null ? "—" : int(r.landingPageViews)}
              </td>
              <td className="px-3 py-2 text-right text-ink-2 tabular-nums">
                {r.conversions === null ? "—" : int(r.conversions)}
              </td>
              <td className="px-3 py-2 text-right text-ink-2 tabular-nums">
                {r.conversionValue === null ? "—" : usd(r.conversionValue)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
