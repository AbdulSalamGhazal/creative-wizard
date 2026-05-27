import { Badge } from "@/components/ui/badge";
import { DownloadCsvButton } from "@/components/ui/download-csv-button";
import { ExcludeRowAction } from "@/components/creative/exclude-row-action";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { int, isoDate, usd } from "@/lib/format";
import type { CreativeRecordRow } from "@/db/queries/creatives";
import { rowsToCsv, todayStamp, type CsvColumn } from "@/lib/csv-export";

const CSV_COLUMNS: CsvColumn<CreativeRecordRow>[] = [
  { key: "date", label: "Date", value: (r) => r.date },
  { key: "platform", label: "Platform", value: (r) => r.platform },
  { key: "spend", label: "Spend (USD)", value: (r) => r.spend },
  { key: "impressions", label: "Impressions", value: (r) => r.impressions },
  { key: "clicks", label: "Clicks", value: (r) => r.clicks },
  { key: "conversions", label: "Conversions", value: (r) => r.conversions },
  { key: "conversionValue", label: "Conversion value (USD)", value: (r) => r.conversionValue },
  { key: "videoViews3s", label: "Video views 3s", value: (r) => r.videoViews3s },
  { key: "videoViews15s", label: "Video views 15s", value: (r) => r.videoViews15s },
  { key: "excluded", label: "Excluded", value: (r) => (r.excludedFromAggregates ? "yes" : "") },
  { key: "excludedReason", label: "Excluded reason", value: (r) => r.excludedReason },
];

interface Props {
  rows: CreativeRecordRow[];
}

export function CreativeRecordsTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center text-ink-3 text-sm">
        No performance records yet for this creative.
      </div>
    );
  }

  const excludedCount = rows.filter((r) => r.excludedFromAggregates).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-ink-3 num">
          {rows.length} records ·{" "}
          {excludedCount > 0 ? (
            <span className="text-warn">{excludedCount} excluded from totals</span>
          ) : (
            <span>none excluded</span>
          )}
        </span>
        <DownloadCsvButton
          csvContent={rowsToCsv(rows, CSV_COLUMNS)}
          filename={`creative-records-${todayStamp()}.csv`}
        />
      </div>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm num">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink-3 border-b border-line">
              <th className="font-medium px-3 py-2.5">Date</th>
              <th className="font-medium px-3 py-2.5">Platform</th>
              <th className="font-medium px-3 py-2.5 text-right">Spend</th>
              <th className="font-medium px-3 py-2.5 text-right">Impressions</th>
              <th className="font-medium px-3 py-2.5 text-right">Clicks</th>
              <th className="font-medium px-3 py-2.5 text-right">Conv.</th>
              <th className="font-medium px-3 py-2.5"></th>
              <th className="font-medium px-3 py-2.5 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr
                key={r.id}
                className={
                  r.excludedFromAggregates
                    ? "opacity-70 hover:bg-surface-2/40 transition-colors"
                    : "hover:bg-surface-2/60 transition-colors"
                }
              >
                <td className="px-3 py-2.5 text-ink-2">{isoDate(r.date)}</td>
                <td className="px-3 py-2.5">
                  <span className="inline-flex items-center gap-2 text-ink-2">
                    <span
                      className="w-1.5 h-1.5 rounded-sm"
                      style={{ background: PLATFORM_COLOR[r.platform] }}
                    />
                    {PLATFORM_LABEL[r.platform]}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right text-ink">
                  {usd(r.spend)}
                </td>
                <td className="px-3 py-2.5 text-right text-ink-2">
                  {int(r.impressions)}
                </td>
                <td className="px-3 py-2.5 text-right text-ink-2">
                  {int(r.clicks)}
                </td>
                <td className="px-3 py-2.5 text-right text-ink-2">
                  {int(r.conversions)}
                </td>
                <td className="px-3 py-2.5">
                  {r.excludedFromAggregates ? (
                    <Badge
                      variant="outline"
                      className="border-warn/40 text-warn bg-warn/10"
                      title={r.excludedReason ?? undefined}
                    >
                      Excluded
                    </Badge>
                  ) : null}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <ExcludeRowAction
                    recordId={r.id}
                    excluded={r.excludedFromAggregates}
                    context={`${isoDate(r.date)} · ${PLATFORM_LABEL[r.platform]} · ${usd(r.spend)}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-ink-3">
        Detail view shows every record. Excluded rows are dimmed and marked; their
        values are not counted in any blended metric across the dashboard.
      </p>
    </div>
  );
}
