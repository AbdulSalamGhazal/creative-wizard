"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { DownloadCsvButton } from "@/components/ui/download-csv-button";
import { rowsToCsv } from "@/lib/csv-export";
import { int, usd } from "@/lib/format";
import { METRIC_LABEL } from "@/lib/metric-labels";
import { PLATFORM_LABEL } from "@/lib/palette";
import { PlatformDot } from "@/components/ui/platform-dot";
import { cn } from "@/lib/utils";
import type { CampaignDayRow, CampaignRecordRow } from "@/db/queries/campaign";

/** Every uploaded metric column. `money` → currency, else integer count. */
const METRIC_COLS: Array<{ key: MetricKey; label: string; money?: boolean }> = [
  { key: "spend", label: "Spend", money: true },
  { key: "impressions", label: METRIC_LABEL.impressions },
  { key: "clicks", label: "Clicks" },
  { key: "landingPageViews", label: "LP views" },
  { key: "addToCart", label: "ATC" },
  { key: "addPayment", label: "AP" },
  { key: "conversions", label: METRIC_LABEL.conversions },
  { key: "conversionValue", label: "Value", money: true },
  { key: "videoViews2s", label: "V·2s" },
  { key: "videoViews25", label: "V·25%" },
  { key: "videoViews50", label: "V·50%" },
  { key: "videoViews75", label: "V·75%" },
  { key: "videoViews100", label: "V·100%" },
];

type MetricKey =
  | "spend"
  | "impressions"
  | "clicks"
  | "landingPageViews"
  | "addToCart"
  | "addPayment"
  | "conversions"
  | "conversionValue"
  | "videoViews2s"
  | "videoViews25"
  | "videoViews50"
  | "videoViews75"
  | "videoViews100";

type Mode = "raw" | "day";
type SortDir = 1 | -1;

const fmtMetric = (v: number | null, money?: boolean) =>
  v === null ? "—" : money ? usd(v) : int(v);

type SortVal = string | number | null;

function sortRows<T>(rows: T[], getVal: (r: T) => SortVal, dir: SortDir): T[] {
  return [...rows].sort((a, b) => {
    const av = getVal(a);
    const bv = getVal(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1; // nulls always last
    if (bv === null) return -1;
    if (typeof av === "string" && typeof bv === "string") {
      return av < bv ? -dir : av > bv ? dir : 0;
    }
    return ((av as number) - (bv as number)) * dir;
  });
}

export function CampaignRecordsTable({
  records,
  byDay,
  campaign,
}: {
  records: CampaignRecordRow[];
  byDay: CampaignDayRow[];
  campaign: string;
}) {
  const [mode, setMode] = useState<Mode>("raw");
  const [sortKey, setSortKey] = useState<string>("date");
  const [dir, setDir] = useState<SortDir>(-1);
  const [order, setOrder] = useState<string[]>([]);

  const getVal = (r: CampaignRecordRow | CampaignDayRow, key: string): SortVal => {
    if (key === "date") return r.date;
    if (key === "creativeName") return "creativeName" in r ? r.creativeName : null;
    if (key === "platform") return "platform" in r ? r.platform : null;
    if (key === "records") return "records" in r ? r.records : null;
    return (r as unknown as Record<string, number | null>)[key] ?? null;
  };

  // The wrapper owns the sort (so the CSV can export exactly what's shown); the
  // DataTable just renders the already-sorted rows + drives header clicks.
  const sortedRecords = useMemo(
    () => sortRows(records, (r) => getVal(r, sortKey), dir),
    [records, sortKey, dir],
  );
  const sortedDays = useMemo(
    () => sortRows(byDay, (r) => getVal(r, sortKey), dir),
    [byDay, sortKey, dir],
  );

  const truncated = records.length >= 2000;

  // Export exactly what's shown (current mode + sort) via the shared CSV
  // helpers + DownloadCsvButton.
  const csvContent = useMemo(() => {
    if (mode === "raw") {
      return rowsToCsv<CampaignRecordRow>(sortedRecords, [
        { key: "date", label: "Date", value: (r) => r.date },
        { key: "creativeName", label: "Creative", value: (r) => r.creativeName },
        { key: "platform", label: "Platform", value: (r) => PLATFORM_LABEL[r.platform] },
        ...METRIC_COLS.map((c) => ({
          key: c.key,
          label: c.label,
          value: (r: CampaignRecordRow) => r[c.key],
        })),
        {
          key: "excluded",
          label: "Excluded",
          value: (r: CampaignRecordRow) => (r.excludedFromAggregates ? "yes" : "no"),
        },
      ]);
    }
    return rowsToCsv<CampaignDayRow>(sortedDays, [
      { key: "date", label: "Date", value: (r) => r.date },
      { key: "records", label: "Rows", value: (r) => r.records },
      ...METRIC_COLS.map((c) => ({
        key: c.key,
        label: c.label,
        value: (r: CampaignDayRow) => r[c.key],
      })),
    ]);
  }, [mode, sortedRecords, sortedDays]);

  const csvFilename = `${
    campaign.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "campaign"
  }-${mode === "day" ? "by-day" : "records"}.csv`;

  const metricColumns = <T,>(): DataColumn<T>[] =>
    METRIC_COLS.map((c) => ({
      key: c.key,
      label: c.label,
      align: "right" as const,
      sortable: true,
      render: (r: T) =>
        fmtMetric((r as unknown as Record<string, number | null>)[c.key] ?? null, c.money),
    }));

  const rawColumns: DataColumn<CampaignRecordRow>[] = [
    {
      key: "date",
      label: "Date",
      align: "left",
      sortable: true,
      pinned: true,
      defaultSortDir: "desc",
      render: (r) => <span className="tabular-nums">{r.date}</span>,
    },
    {
      key: "creativeName",
      label: "Creative",
      align: "left",
      sortable: true,
      render: (r) => (
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="block truncate max-w-[14rem] font-mono text-xs" title={r.creativeName}>
            {r.creativeName}
          </span>
          {r.excludedFromAggregates && (
            <Badge
              variant="outline"
              className="text-[9px] border-warn/40 text-warn bg-warn/10"
            >
              Excluded
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: "platform",
      label: "Platform",
      align: "left",
      sortable: true,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs">
          <PlatformDot platform={r.platform} />
          {PLATFORM_LABEL[r.platform]}
        </span>
      ),
    },
    ...metricColumns<CampaignRecordRow>(),
  ];

  const dayColumns: DataColumn<CampaignDayRow>[] = [
    {
      key: "date",
      label: "Date",
      align: "left",
      sortable: true,
      pinned: true,
      defaultSortDir: "desc",
      render: (r) => <span className="tabular-nums">{r.date}</span>,
    },
    {
      key: "records",
      label: "Rows",
      align: "right",
      sortable: true,
      render: (r) => <span className="text-ink-3">{r.records}</span>,
    },
    ...metricColumns<CampaignDayRow>(),
  ];

  const onSort = (key: string, d: "asc" | "desc") => {
    setSortKey(key);
    setDir(d === "asc" ? 1 : -1);
  };
  const sharedProps = {
    sort: sortKey,
    dir: (dir === 1 ? "asc" : "desc") as "asc" | "desc",
    onSort,
    order,
    onReorder: setOrder,
    minWidthClass: "min-w-[1100px]",
  };

  if (records.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center text-ink-3 text-sm">
        No records in this window.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex items-center rounded-md border border-line bg-surface-2 p-0.5 text-[11px]">
          {(
            [
              ["raw", "Per record"],
              ["day", "By day"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setMode(k)}
              className={cn(
                "px-2.5 h-7 rounded transition-colors",
                mode === k ? "bg-surface-3 text-ink" : "text-ink-3 hover:text-ink",
              )}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-ink-3 num">
            {mode === "raw"
              ? `${records.length}${truncated ? "+" : ""} records`
              : `${byDay.length} days`}
          </span>
          <DownloadCsvButton
            csvContent={csvContent}
            filename={csvFilename}
            label="CSV"
          />
        </div>
      </div>

      {mode === "raw" ? (
        <DataTable
          {...sharedProps}
          columns={rawColumns}
          rows={sortedRecords}
          rowKey={(r) => String(r.id)}
          rowClassName={(r) => (r.excludedFromAggregates ? "opacity-55" : "")}
        />
      ) : (
        <DataTable {...sharedProps} columns={dayColumns} rows={sortedDays} rowKey={(r) => r.date} />
      )}

      {truncated && mode === "raw" && (
        <p className="text-[10px] text-ink-3">
          Showing the first 2,000 records. Switch to “By day” for the full window, or narrow the
          date range.
        </p>
      )}
    </div>
  );
}
