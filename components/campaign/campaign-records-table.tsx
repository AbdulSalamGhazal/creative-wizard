"use client";

import { useMemo, useState } from "react";
import { exclusionRuleLabel } from "@/lib/exclusion-rule-label";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { TABLE_KEYS, type TableColumnPref } from "@/lib/table-columns";
import { DownloadCsvButton } from "@/components/ui/download-csv-button";
import { rowsToCsv } from "@/lib/csv-export";
import { int, isoDate, pct, roas, usd } from "@/lib/format";
import { METRIC_LABEL } from "@/lib/metric-labels";
import { PLATFORM_LABEL, TYPE_LABEL } from "@/lib/palette";
import { recordRatios, type RecordRatios } from "@/lib/record-ratios";
import { isCreativeStage, stageRank } from "@/lib/funnel-stages";
import { PriorityStars } from "@/components/creative/priority-stars";
import { StageChips } from "@/components/creative/stage-chips";
import { PlatformDot } from "@/components/ui/platform-dot";
import { cn } from "@/lib/utils";
import type { CampaignDayRow, CampaignRecordRow } from "@/db/queries/campaign";
import { EmptyState } from "@/components/ui/empty-state";
import { Chip } from "@/components/ui/chip";

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

/**
 * The non-pinned column keys, in config order — what the columns control
 * reorders and what a saved order is merged against. Derived from the same
 * METRIC_COLS the table renders, so a new metric needs no second list.
 *
 * Both modes share ONE preference: they are the same table with the same
 * metrics, and remembering "hide the video columns" twice would be a trap.
 */
/**
 * The row's own ratios, derived from its own components (`recordRatios`, the
 * house JS mirror of lib/metrics) — a raw record's, or a day's sums. Which
 * ones a mode offers is that mode's call: CTR/CPA/ROAS per record, CPM/CPA/
 * ROAS per day.
 */
const RATIO_COLS: Record<
  keyof RecordRatios,
  { label: string; fmt: (v: number | null) => string }
> = {
  ctr: { label: METRIC_LABEL.ctr, fmt: pct },
  cpm: { label: METRIC_LABEL.cpm, fmt: usd },
  cpa: { label: METRIC_LABEL.cpa, fmt: usd },
  roas: { label: METRIC_LABEL.roas, fmt: roas },
};
const RAW_RATIOS: Array<keyof RecordRatios> = ["ctr", "cpa", "roas"];
const DAY_RATIOS: Array<keyof RecordRatios> = ["cpm", "cpa", "roas"];

/**
 * Offered, hidden by default (2026-11): what the query already carries at the
 * row's grain. A key that doesn't exist in one mode (a day has no creative)
 * is simply absent from that mode's config — as `creativeName` always was.
 */
const FREE_KEYS = [
  "ctr",
  "cpm",
  "cpa",
  "roas",
  "landingPage",
  "productName",
  "creativeType",
  "creativeStages",
  "creativePriority",
  "creativeLaunchDate",
  "excludedSource",
  "excludedReason",
  "excludedAt",
];
const DEFAULT_HIDDEN = FREE_KEYS;

const RECORD_COLUMN_KEYS = [
  "creativeName",
  "platform",
  "records",
  ...METRIC_COLS.map((c) => c.key as string),
  ...FREE_KEYS,
];

/** A creative's stage set as ONE comparable number — its earliest stage in
 *  funnel order; `null` (sinks) when nothing is declared. */
function earliestStageRank(stages: readonly string[]): number | null {
  const ranks = stages.filter(isCreativeStage).map(stageRank);
  return ranks.length === 0 ? null : Math.min(...ranks);
}

/** The rule behind a rule-excluded row, in words. */
function ruleLabelOf(r: CampaignRecordRow): string {
  return exclusionRuleLabel(
    { kind: r.excludedRuleKind, objective: r.excludedRuleObjective },
    { creativeName: r.creativeName },
  );
}

/** How the row was excluded, in words — "Manual", "Rule · <rule>", or null. */
function exclusionSourceText(r: CampaignRecordRow): string | null {
  if (r.excludedSource === "rule") return `Rule · ${ruleLabelOf(r)}`;
  if (r.excludedSource === "manual") return "Manual";
  return null;
}

const DASH_CELL = <span className="text-ink-3">—</span>;

export function CampaignRecordsTable({
  records,
  byDay,
  campaign,
  columnPref,
}: {
  records: CampaignRecordRow[];
  byDay: CampaignDayRow[];
  campaign: string;
  /** This user's remembered columns for this brand, resolved server-side. */
  columnPref?: TableColumnPref;
}) {
  const [mode, setMode] = useState<Mode>("raw");
  const [sortKey, setSortKey] = useState<string>("date");
  const [dir, setDir] = useState<SortDir>(-1);
  const cols = useTableColumns({
    tableKey: TABLE_KEYS.CAMPAIGN_RECORDS,
    hideable: RECORD_COLUMN_KEYS,
    defaults: RECORD_COLUMN_KEYS,
    defaultHidden: DEFAULT_HIDDEN,
    initial: columnPref,
  });

  const getVal = (r: CampaignRecordRow | CampaignDayRow, key: string): SortVal => {
    if (key === "date") return r.date;
    if (key === "creativeName") return "creativeName" in r ? r.creativeName : null;
    if (key === "platform") return "platform" in r ? r.platform : null;
    if (key === "records") return "records" in r ? r.records : null;
    if (key === "ctr" || key === "cpm" || key === "cpa" || key === "roas") {
      return recordRatios(r)[key];
    }
    if ("creativeName" in r) {
      // The raw-only identity / provenance columns. Absence sorts last.
      if (key === "landingPage") return r.landingPageCode;
      if (key === "productName") return r.productName;
      if (key === "creativeType") return TYPE_LABEL[r.creativeType];
      if (key === "creativeStages") return earliestStageRank(r.creativeStages);
      if (key === "creativePriority") return r.creativePriority;
      if (key === "creativeLaunchDate") return r.creativeLaunchDate;
      if (key === "excludedSource") return exclusionSourceText(r);
      if (key === "excludedReason") return r.excludedReason;
      if (key === "excludedAt") return r.excludedAt ? r.excludedAt.toISOString() : null;
    }
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

  /** A day's ratios are Σ ÷ Σ over that day's sums — the same helper, since a
   *  day row carries exactly the components a record does. */
  const ratioColumns = <T extends CampaignRecordRow | CampaignDayRow>(
    keys: Array<keyof RecordRatios>,
  ): DataColumn<T>[] =>
    keys.map((k) => ({
      key: k,
      label: RATIO_COLS[k].label,
      align: "right" as const,
      sortable: true,
      render: (r: T) => RATIO_COLS[k].fmt(recordRatios(r)[k]),
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
          <span dir="auto" className="block truncate max-w-[14rem] font-mono text-xs" title={r.creativeName}>
            {r.creativeName}
          </span>
          {r.excludedFromAggregates && (
            <Chip
              tone="warn"
              title={
                r.excludedSource === "rule"
                  ? `Excluded by rule «${exclusionRuleLabel(
                      { kind: r.excludedRuleKind, objective: r.excludedRuleObjective },
                      { creativeName: r.creativeName },
                    )}» — manage it in Configuration → Exclusions.`
                  : undefined
              }
            >
              {/* Rule vs manual is visible, not only in a title (R-007). */}
              {r.excludedSource === "rule" ? "Excluded · rule" : "Excluded"}
            </Chip>
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
    ...ratioColumns<CampaignRecordRow>(RAW_RATIOS),
    // ── Offered, hidden by default: identity and provenance ──
    {
      key: "landingPage",
      label: "Landing page",
      align: "left",
      sortable: true,
      // The code is what the ad name carries; the page's name rides the
      // title. A dash is the product's own page — as on creative records.
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
    {
      key: "productName",
      label: "Product",
      align: "left",
      sortable: true,
      render: (r) => (
        <span className="block max-w-[12rem] truncate text-ink-2" title={r.productName}>
          {r.productName}
        </span>
      ),
    },
    {
      key: "creativeType",
      label: "Type",
      align: "left",
      sortable: true,
      render: (r) => <span className="text-ink-2">{TYPE_LABEL[r.creativeType]}</span>,
    },
    {
      key: "creativeStages",
      label: "Stage",
      align: "left",
      sortable: true,
      render: (r) => <StageChips stages={r.creativeStages} nowrap />,
    },
    {
      key: "creativePriority",
      label: "Priority",
      align: "left",
      sortable: true,
      render: (r) => <PriorityStars value={r.creativePriority} />,
    },
    {
      key: "creativeLaunchDate",
      label: "Launch date",
      align: "left",
      sortable: true,
      render: (r) =>
        r.creativeLaunchDate ? (
          <span className="tabular-nums text-ink-2">{isoDate(r.creativeLaunchDate)}</span>
        ) : (
          DASH_CELL
        ),
    },
    {
      key: "excludedSource",
      label: "Exclusion",
      align: "left",
      sortable: true,
      render: (r) => {
        const text = exclusionSourceText(r);
        return text ? (
          <span className="block max-w-[16rem] truncate text-ink-2" title={text}>
            {text}
          </span>
        ) : (
          DASH_CELL
        );
      },
    },
    {
      key: "excludedReason",
      label: "Excluded reason",
      align: "left",
      sortable: true,
      render: (r) =>
        r.excludedReason ? (
          <span className="block max-w-[16rem] truncate text-ink-2" title={r.excludedReason}>
            {r.excludedReason}
          </span>
        ) : (
          DASH_CELL
        ),
    },
    {
      key: "excludedAt",
      label: "Excluded at",
      align: "left",
      sortable: true,
      render: (r) =>
        r.excludedAt ? (
          <span className="whitespace-nowrap tabular-nums text-ink-2">{isoDate(r.excludedAt)}</span>
        ) : (
          DASH_CELL
        ),
    },
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
    ...ratioColumns<CampaignDayRow>(DAY_RATIOS),
  ];

  const onSort = (key: string, d: "asc" | "desc") => {
    setSortKey(key);
    setDir(d === "asc" ? 1 : -1);
  };
  const sharedProps = {
    sort: sortKey,
    dir: (dir === 1 ? "asc" : "desc") as "asc" | "desc",
    onSort,
    // Key, state and handlers in one object — the whole columns control.
    ...cols.tableProps,
    minWidthClass: "min-w-[1100px]",
  };

  if (records.length === 0) {
    return (
      <EmptyState title="No records in this window." kind="range" />
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
                "px-2.5 h-7 rounded-sm transition-colors",
                mode === k ? "bg-surface-3 text-ink" : "text-ink-3 hover:text-ink",
              )}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-ink-3 tabular-nums">
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
          // Up to 2,000 rows: render 200 at a time (R-029).
          pageSize={200}
        />
      ) : (
        <DataTable {...sharedProps} columns={dayColumns} rows={sortedDays} rowKey={(r) => r.date} />
      )}

      {truncated && mode === "raw" && (
        <p className="text-[10px] text-ink-2">
          Showing the first 2,000 records. Switch to “By day” for the full window, or narrow the
          date range.
        </p>
      )}
    </div>
  );
}
