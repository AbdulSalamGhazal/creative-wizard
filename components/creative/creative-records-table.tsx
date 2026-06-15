"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronRight,
  Columns3,
  List,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DownloadCsvButton } from "@/components/ui/download-csv-button";
import { ExcludeRowAction } from "@/components/creative/exclude-row-action";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { int, isoDate, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CreativeRecordRow } from "@/db/queries/creatives";
import { rowsToCsv, todayStamp, type CsvColumn } from "@/lib/csv-export";

// CSV export is always the full record (every uploaded field), independent of
// which columns the table is currently showing.
const CSV_COLUMNS: CsvColumn<CreativeRecordRow>[] = [
  { key: "date", label: "Date", value: (r) => r.date },
  { key: "platform", label: "Platform", value: (r) => r.platform },
  { key: "campaignName", label: "Campaign Name", value: (r) => r.campaignName },
  { key: "spend", label: "Spend (USD)", value: (r) => r.spend },
  { key: "impressions", label: "Impressions", value: (r) => r.impressions },
  { key: "clicks", label: "Clicks", value: (r) => r.clicks },
  { key: "conversions", label: "Conversions", value: (r) => r.conversions },
  { key: "conversionValue", label: "Conversion value (USD)", value: (r) => r.conversionValue },
  { key: "landingPageViews", label: "Landing page views", value: (r) => r.landingPageViews },
  { key: "addToCart", label: "Add to cart", value: (r) => r.addToCart },
  { key: "addPayment", label: "Add payment", value: (r) => r.addPayment },
  { key: "videoViews2s", label: "Video views 2s", value: (r) => r.videoViews2s },
  { key: "videoViews25", label: "Video views 25%", value: (r) => r.videoViews25 },
  { key: "videoViews50", label: "Video views 50%", value: (r) => r.videoViews50 },
  { key: "videoViews75", label: "Video views 75%", value: (r) => r.videoViews75 },
  { key: "videoViews100", label: "Video views 100%", value: (r) => r.videoViews100 },
  { key: "excluded", label: "Excluded", value: (r) => (r.excludedFromAggregates ? "yes" : "") },
  { key: "excludedReason", label: "Excluded reason", value: (r) => r.excludedReason },
];

type Dir = "asc" | "desc";

interface Col {
  key: string;
  label: string;
  numeric: boolean;
  /** Shown only in the "All columns" view (every uploaded metric). */
  extended?: boolean;
  sortVal: (r: CreativeRecordRow) => number | string;
  cell: (r: CreativeRecordRow) => React.ReactNode;
}

const n0 = (v: number | null) => v ?? 0;

// Identity + raw uploaded metric columns (no derived metrics like CTR/CPA/ROAS).
const COLUMNS: Col[] = [
  {
    key: "date",
    label: "Date",
    numeric: false,
    sortVal: (r) => r.date,
    cell: (r) => <span className="text-ink-2">{isoDate(r.date)}</span>,
  },
  {
    key: "platform",
    label: "Platform",
    numeric: false,
    sortVal: (r) => PLATFORM_LABEL[r.platform],
    cell: (r) => (
      <span className="inline-flex items-center gap-2 text-ink-2 whitespace-nowrap">
        <span
          className="w-1.5 h-1.5 rounded-sm"
          style={{ background: PLATFORM_COLOR[r.platform] }}
        />
        {PLATFORM_LABEL[r.platform]}
      </span>
    ),
  },
  {
    key: "campaign",
    label: "Campaign",
    numeric: false,
    sortVal: (r) => r.campaignName,
    cell: (r) => (
      <span className="block max-w-[22rem] truncate text-ink-2" title={r.campaignName}>
        {r.campaignName}
      </span>
    ),
  },
  { key: "spend", label: "Spend", numeric: true, sortVal: (r) => r.spend, cell: (r) => <span className="text-ink">{usd(r.spend)}</span> },
  { key: "impressions", label: "Impr.", numeric: true, sortVal: (r) => r.impressions, cell: (r) => int(r.impressions) },
  { key: "clicks", label: "Clicks", numeric: true, sortVal: (r) => r.clicks, cell: (r) => int(r.clicks) },
  { key: "conversions", label: "Conv.", numeric: true, sortVal: (r) => n0(r.conversions), cell: (r) => int(r.conversions) },
  // Extended — every other uploaded field.
  { key: "conversionValue", label: "Conv. value", numeric: true, extended: true, sortVal: (r) => n0(r.conversionValue), cell: (r) => usd(r.conversionValue) },
  { key: "landingPageViews", label: "LP views", numeric: true, extended: true, sortVal: (r) => n0(r.landingPageViews), cell: (r) => int(r.landingPageViews) },
  { key: "addToCart", label: "Add to cart", numeric: true, extended: true, sortVal: (r) => n0(r.addToCart), cell: (r) => int(r.addToCart) },
  { key: "addPayment", label: "Add payment", numeric: true, extended: true, sortVal: (r) => n0(r.addPayment), cell: (r) => int(r.addPayment) },
  { key: "videoViews2s", label: "Video 2s", numeric: true, extended: true, sortVal: (r) => n0(r.videoViews2s), cell: (r) => int(r.videoViews2s) },
  { key: "videoViews25", label: "Video 25%", numeric: true, extended: true, sortVal: (r) => n0(r.videoViews25), cell: (r) => int(r.videoViews25) },
  { key: "videoViews50", label: "Video 50%", numeric: true, extended: true, sortVal: (r) => n0(r.videoViews50), cell: (r) => int(r.videoViews50) },
  { key: "videoViews75", label: "Video 75%", numeric: true, extended: true, sortVal: (r) => n0(r.videoViews75), cell: (r) => int(r.videoViews75) },
  { key: "videoViews100", label: "Video 100%", numeric: true, extended: true, sortVal: (r) => n0(r.videoViews100), cell: (r) => int(r.videoViews100) },
];

interface Props {
  rows: CreativeRecordRow[];
  /** Heading on the disclosure ("All records" / "Records in range"). */
  title?: string;
}

/**
 * The creative's raw performance records. Collapsed by default — click the
 * header to open. Toggle "All columns" to see every uploaded field (no derived
 * metrics); click any column header to sort. Excluded rows are dimmed.
 */
export function CreativeRecordsTable({ rows, title = "All records" }: Props) {
  const [open, setOpen] = useState(false);
  const [allCols, setAllCols] = useState(false);
  const [sortKey, setSortKey] = useState<string>("date");
  const [dir, setDir] = useState<Dir>("desc");

  const excludedCount = rows.filter((r) => r.excludedFromAggregates).length;
  const visibleCols = useMemo(
    () => COLUMNS.filter((c) => allCols || !c.extended),
    [allCols],
  );

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sortKey) ?? COLUMNS[0]!;
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = col.sortVal(a);
      const bv = col.sortVal(b);
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [rows, sortKey, dir]);

  const onSort = (key: string) => {
    if (sortKey === key) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDir(COLUMNS.find((c) => c.key === key)?.numeric ? "desc" : "asc");
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 hover:bg-surface-2/50 transition-colors"
      >
        <span className="inline-flex items-center gap-2 text-sm font-medium text-ink">
          <ChevronRight
            className={cn(
              "w-4 h-4 text-ink-3 transition-transform",
              open && "rotate-90",
            )}
          />
          {title}
          <span className="text-[11px] text-ink-3 font-normal num">
            {rows.length} record{rows.length === 1 ? "" : "s"}
            {excludedCount > 0 && (
              <span className="text-warn"> · {excludedCount} excluded</span>
            )}
          </span>
        </span>
        <span className="text-[11px] text-ink-3">{open ? "Hide" : "Show"}</span>
      </button>

      {open &&
        (rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center text-ink-3 text-sm">
            No performance records yet for this creative.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setAllCols((a) => !a)}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-line text-xs text-ink-2 hover:text-ink hover:bg-surface-2 transition-colors"
              >
                {allCols ? (
                  <List className="w-3.5 h-3.5" />
                ) : (
                  <Columns3 className="w-3.5 h-3.5" />
                )}
                {allCols ? "Compact columns" : "All columns"}
              </button>
              <DownloadCsvButton
                csvContent={rowsToCsv(sorted, CSV_COLUMNS)}
                filename={`creative-records-${todayStamp()}.csv`}
              />
            </div>

            <div className="overflow-x-auto rounded-lg border border-line bg-surface">
              <table className="w-full text-sm num min-w-max">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink-3 border-b border-line">
                    {visibleCols.map((c) => {
                      const active = sortKey === c.key;
                      return (
                        <th
                          key={c.key}
                          className={cn(
                            "font-medium px-3 py-2.5",
                            c.numeric ? "text-right" : "text-left",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => onSort(c.key)}
                            className={cn(
                              "inline-flex items-center gap-1 hover:text-ink transition-colors max-w-full",
                              c.numeric && "justify-end w-full",
                              active && "text-brand",
                            )}
                          >
                            <span>{c.label}</span>
                            <SortIcon active={active} dir={dir} />
                          </button>
                        </th>
                      );
                    })}
                    {/* Excluded badge + row action — not sortable */}
                    <th className="font-medium px-3 py-2.5" />
                    <th className="font-medium px-3 py-2.5 text-right" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {sorted.map((r) => (
                    <tr
                      key={r.id}
                      className={cn(
                        "hover:bg-surface-2/50 transition-colors",
                        r.excludedFromAggregates && "opacity-70",
                      )}
                    >
                      {visibleCols.map((c) => (
                        <td
                          key={c.key}
                          className={cn(
                            "px-3 py-2.5",
                            c.numeric && "text-right text-ink-2 tabular-nums",
                          )}
                        >
                          {c.cell(r)}
                        </td>
                      ))}
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
              Every record is shown. Excluded rows are dimmed and marked; their
              values are not counted in any blended metric. Toggle All columns to
              see every uploaded field.
            </p>
          </>
        ))}
    </div>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: Dir }) {
  if (!active) {
    return <ArrowUpDown className="w-3 h-3 text-ink-3 opacity-60" aria-hidden />;
  }
  return dir === "asc" ? (
    <ArrowUp className="w-3 h-3 text-brand" aria-hidden />
  ) : (
    <ArrowDown className="w-3 h-3 text-brand" aria-hidden />
  );
}
