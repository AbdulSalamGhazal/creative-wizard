"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { TABLE_KEYS } from "@/lib/table-columns";
import { DownloadCsvButton } from "@/components/ui/download-csv-button";
import { ExcludeRowAction } from "@/components/creative/exclude-row-action";
import { PLATFORM_LABEL } from "@/lib/palette";
import { PlatformDot } from "@/components/ui/platform-dot";
import { int, isoDate, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CreativeRecordRow } from "@/db/queries/creatives";
import { rowsToCsv, todayStamp, type CsvColumn } from "@/lib/csv-export";
import { METRIC_LABEL } from "@/lib/metric-labels";
import { EmptyState } from "@/components/ui/empty-state";

// CSV export is always the full record (every uploaded field), independent of
// which columns the table is currently showing — the Library's rule.
const CSV_COLUMNS: CsvColumn<CreativeRecordRow>[] = [
  { key: "date", label: "Date", value: (r) => r.date },
  { key: "platform", label: "Platform", value: (r) => r.platform },
  { key: "campaignName", label: "Campaign Name", value: (r) => r.campaignName },
  { key: "landingPage", label: "Landing page", value: (r) => (r.landingPageCode ? `@${r.landingPageCode}` : "") },
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

const n0 = (v: number | null) => v ?? 0;

/**
 * The raw uploaded metrics, in display order. `on: false` is the old
 * "All columns" set — every uploaded field beyond the four everyone reads —
 * which is now the table's `defaultHidden` rather than an all-or-nothing
 * toggle, so a single extra field can be opened without the other eight.
 */
const METRICS: Array<{
  key: string;
  label: string;
  on: boolean;
  money?: boolean;
  pick: (r: CreativeRecordRow) => number | null;
}> = [
  { key: "spend", label: METRIC_LABEL.spend, on: true, money: true, pick: (r) => r.spend },
  { key: "impressions", label: METRIC_LABEL.impressions, on: true, pick: (r) => r.impressions },
  { key: "clicks", label: METRIC_LABEL.clicks, on: true, pick: (r) => r.clicks },
  { key: "conversions", label: METRIC_LABEL.conversions, on: true, pick: (r) => r.conversions },
  { key: "conversionValue", label: METRIC_LABEL.revenue, on: false, money: true, pick: (r) => r.conversionValue },
  { key: "landingPageViews", label: METRIC_LABEL.landingPageViews, on: false, pick: (r) => r.landingPageViews },
  { key: "addToCart", label: METRIC_LABEL.addToCart, on: false, pick: (r) => r.addToCart },
  { key: "addPayment", label: METRIC_LABEL.addPayment, on: false, pick: (r) => r.addPayment },
  { key: "videoViews2s", label: "Video 2s", on: false, pick: (r) => r.videoViews2s },
  { key: "videoViews25", label: "Video 25%", on: false, pick: (r) => r.videoViews25 },
  { key: "videoViews50", label: "Video 50%", on: false, pick: (r) => r.videoViews50 },
  { key: "videoViews75", label: "Video 75%", on: false, pick: (r) => r.videoViews75 },
  { key: "videoViews100", label: "Video 100%", on: false, pick: (r) => r.videoViews100 },
];

/** Opt-in columns the row has always carried: the exclusion's own provenance,
 *  which until now lived only in a tooltip and the CSV. */
const PROVENANCE_KEYS = ["excludedReason", "excludedAt"];
const DEFAULT_HIDDEN = [
  // The ` @code` landing page (2026-10) — most rows go to the product's own
  // page, so it's offered, not shown.
  "landingPage",
  ...METRICS.filter((m) => !m.on).map((m) => m.key),
  ...PROVENANCE_KEYS,
];

/**
 * EXPORTED for the unit test. The comparator this table has always used:
 * numbers numerically with NULL READ AS ZERO (an unreported metric sorts
 * where 0 would, which is this table's long-standing behaviour and NOT the
 * primitive's nulls-sink rule), everything else by string compare. The
 * wrapper owns the sort, so the CSV can export in the on-screen order.
 */
export function compareRecords(
  a: CreativeRecordRow,
  b: CreativeRecordRow,
  key: string,
): number {
  const metric = METRICS.find((m) => m.key === key);
  if (metric) return n0(metric.pick(a)) - n0(metric.pick(b));
  const pick = (r: CreativeRecordRow): string => {
    if (key === "platform") return PLATFORM_LABEL[r.platform];
    if (key === "campaign") return r.campaignName;
    if (key === "landingPage") return r.landingPageCode ?? "";
    if (key === "excludedReason") return r.excludedReason ?? "";
    if (key === "excludedAt") return r.excludedAt ? r.excludedAt.toISOString() : "";
    return r.date;
  };
  return pick(a).localeCompare(pick(b));
}

interface Props {
  rows: CreativeRecordRow[];
  /** Heading on the disclosure ("All records" / "Records in range"). */
  title?: string;
}

/**
 * The creative's raw performance records. Collapsed by default — click the
 * header to open. Every uploaded field is OFFERED in the table's own columns
 * control (the nine beyond the headline four start hidden, which is what the
 * old all-or-nothing "All columns" button used to toggle in one go); click a
 * column header to sort. Excluded rows are dimmed, badged in the Date cell,
 * and carry the exclude/re-include action in their last column.
 */
export function CreativeRecordsTable({ rows, title = "All records" }: Props) {
  const [open, setOpen] = useState(false);
  const [sortKey, setSortKey] = useState<string>("date");
  const [dir, setDir] = useState<Dir>("desc");

  const excludedCount = rows.filter((r) => r.excludedFromAggregates).length;

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const c = compareRecords(a, b, sortKey);
      return dir === "asc" ? c : -c;
    });
    return arr;
  }, [rows, sortKey, dir]);

  const columns = useMemo<DataColumn<CreativeRecordRow>[]>(
    () => [
      {
        key: "date",
        label: "Date",
        align: "left",
        sortable: true,
        pinned: true,
        defaultSortDir: "desc",
        render: (r) => (
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-ink-2">{isoDate(r.date)}</span>
            {/* The badge rides the identity cell, as it does on the campaign
                records table — so it stays visible with the date when the
                metrics scroll sideways. */}
            {r.excludedFromAggregates && (
              <Badge
                variant="outline"
                className="border-warn/40 bg-warn/10 text-[9px] text-warn"
                title={
                  r.excludedSource === "rule"
                    ? "Excluded by an exclusion rule — manage it in Configuration → Exclusions."
                    : (r.excludedReason ?? undefined)
                }
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
        defaultSortDir: "asc",
        render: (r) => (
          <span className="inline-flex items-center gap-2 whitespace-nowrap text-ink-2">
            <PlatformDot platform={r.platform} size="sm" />
            {PLATFORM_LABEL[r.platform]}
          </span>
        ),
      },
      {
        key: "campaign",
        label: "Campaign",
        align: "left",
        sortable: true,
        defaultSortDir: "asc",
        render: (r) => (
          <span
            className="block max-w-[12rem] truncate text-ink-2 sm:max-w-[22rem]"
            title={r.campaignName}
          >
            {r.campaignName}
          </span>
        ),
      },
      {
        key: "landingPage",
        label: "Landing page",
        align: "left",
        sortable: true,
        defaultSortDir: "asc",
        // The code is what the ad name carries; the page's name rides the
        // title. A dash is the product's own page.
        render: (r) =>
          r.landingPageCode ? (
            <span
              className="block max-w-[8rem] truncate font-mono text-xs text-ink-2 sm:max-w-[12rem]"
              title={r.landingPageName ?? undefined}
            >
              @{r.landingPageCode}
            </span>
          ) : (
            <span className="text-ink-3" title="The product's own page">
              —
            </span>
          ),
      },
      ...METRICS.map<DataColumn<CreativeRecordRow>>((m) => ({
        key: m.key,
        label: m.label,
        align: "right",
        sortable: true,
        defaultSortDir: "desc",
        render: (r) =>
          m.money ? (
            <span className={m.key === "spend" ? "text-ink" : "text-ink-2"}>
              {usd(m.pick(r))}
            </span>
          ) : (
            <span className="text-ink-2">{int(m.pick(r))}</span>
          ),
      })),
      {
        key: "excludedReason",
        label: "Excluded reason",
        align: "left",
        sortable: true,
        defaultSortDir: "asc",
        render: (r) =>
          r.excludedReason ? (
            <span className="block max-w-[16rem] truncate text-ink-2" title={r.excludedReason}>
              {r.excludedReason}
            </span>
          ) : (
            <span className="text-ink-3">—</span>
          ),
      },
      {
        key: "excludedAt",
        label: "Excluded at",
        align: "left",
        sortable: true,
        defaultSortDir: "asc",
        render: (r) =>
          r.excludedAt ? (
            <span className="whitespace-nowrap text-ink-2">{isoDate(r.excludedAt)}</span>
          ) : (
            <span className="text-ink-3">—</span>
          ),
      },
      {
        key: "exclude",
        label: "Exclude",
        align: "right",
        // Not hideable: this column is the only way to exclude or re-include a
        // record, and a hidden action is an action nobody can find.
        lockedVisible: true,
        render: (r) => (
          <ExcludeRowAction
            recordId={r.id}
            excluded={r.excludedFromAggregates}
            excludedSource={r.excludedSource}
            context={`${isoDate(r.date)} · ${PLATFORM_LABEL[r.platform]} · ${usd(r.spend)}`}
          />
        ),
      },
    ],
    [],
  );

  const columnKeys = columns.filter((c) => !c.pinned).map((c) => c.key);
  const cols = useTableColumns({
    tableKey: TABLE_KEYS.CREATIVE_RECORDS,
    hideable: columnKeys,
    defaults: columnKeys,
    defaultHidden: DEFAULT_HIDDEN,
  });

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 transition-colors hover:bg-surface-2/50"
      >
        <span className="inline-flex items-center gap-2 text-sm font-medium text-ink">
          <ChevronRight
            className={cn(
              "h-4 w-4 text-ink-3 transition-transform",
              open && "rotate-90",
            )}
          />
          {title}
          <span className="num text-[11px] font-normal text-ink-3">
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
          <EmptyState title="No performance records yet for this creative." />
        ) : (
          <>
            <div className="flex justify-end">
              <DownloadCsvButton
                csvContent={rowsToCsv(sorted, CSV_COLUMNS)}
                filename={`creative-records-${todayStamp()}.csv`}
              />
            </div>

            <DataTable
              columns={columns}
              rows={sorted}
              rowKey={(r) => String(r.id)}
              sort={sortKey}
              dir={dir}
              // Each column states its own first-click direction through
              // `defaultSortDir`, so the primitive's proposal is already the
              // rule this table has always had: text ascends, numbers descend.
              onSort={(key, d) => {
                setSortKey(key);
                setDir(d);
              }}
              {...cols.tableProps}
              rowClassName={(r) => cn(r.excludedFromAggregates && "opacity-70")}
              minWidthClass="min-w-max"
            />

            <p className="text-[11px] text-ink-3">
              Every record is shown. Excluded rows are dimmed and marked; their
              values are not counted in any blended metric. The columns control
              offers every uploaded field.
            </p>
          </>
        ))}
    </div>
  );
}
