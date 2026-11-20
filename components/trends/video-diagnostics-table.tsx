"use client";

import { useMemo, useState } from "react";
import Link from "@/components/nav/link";
import { useSearchParams } from "next/navigation";
import { withDateRange } from "@/lib/url";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { TABLE_KEYS } from "@/lib/table-columns";
import { int, isoDate, pct, roas, usd } from "@/lib/format";
import { METRIC_LABEL } from "@/lib/metric-labels";
import { StatusBadge } from "@/components/creative/status-badge";
import { STATUS_ORDER } from "@/lib/creative-status";
import { PriorityStars } from "@/components/creative/priority-stars";
import { StageChips } from "@/components/creative/stage-chips";
import { ExternalCell } from "@/components/creative/external-cell";
import type { VideoDiagnosticRow } from "@/db/queries/trends";
import { EmptyState } from "@/components/ui/empty-state";

const DASH = "—";
type Num = number | null;
const fPct = (v: Num) => (v === null ? DASH : pct(v));
const fRatio = (v: Num) => roas(v);
const fInt = (v: Num) => (v === null ? DASH : int(v));

type Key = Exclude<keyof VideoDiagnosticRow, "creativeId" | "name">;

interface Col {
  key: Key;
  label: string;
  kind: "num" | "text" | "status" | "date" | "priority" | "stages" | "url";
  fmt?: (v: Num) => string;
  /** Flag amber when below this median (the funnel-rate columns). */
  median?: "hook" | "hold" | "complete";
}

const COLS: Col[] = [
  { key: "productName", label: "Product", kind: "text" },
  { key: "status", label: "Status", kind: "status" },
  { key: "spend", label: "Spend", kind: "num", fmt: usd },
  { key: "impressions", label: METRIC_LABEL.impressions, kind: "num", fmt: fInt },
  { key: "hookRate", label: "Hook", kind: "num", fmt: fPct, median: "hook" },
  { key: "ret25", label: "25%", kind: "num", fmt: fPct },
  { key: "holdRate", label: "Hold (50%)", kind: "num", fmt: fPct, median: "hold" },
  { key: "ret75", label: "75%", kind: "num", fmt: fPct },
  { key: "completeRate", label: "Complete", kind: "num", fmt: fPct, median: "complete" },
  { key: "ctr", label: "CTR", kind: "num", fmt: fPct },
  { key: "cvr", label: "CvR", kind: "num", fmt: fPct },
  { key: "cpa", label: "CPA", kind: "num", fmt: usd },
  { key: "roas", label: "ROAS", kind: "num", fmt: fRatio },
  { key: "costPerHook", label: "Cost/hook", kind: "num", fmt: usd },
  { key: "costPerCompletion", label: "Cost/compl.", kind: "num", fmt: usd },
  // ── Offered, hidden by default (2026-10): the RAW COUNTS behind the rates.
  // The query has always returned them, and a retention curve is unreadable
  // without its denominator — "Hold 48%" of 300 plays is not the same finding
  // as 48% of 300,000.
  { key: "v2s", label: "Plays 2s", kind: "num", fmt: fInt },
  { key: "v25", label: "Plays 25%", kind: "num", fmt: fInt },
  { key: "v50", label: "Plays 50%", kind: "num", fmt: fInt },
  { key: "v75", label: "Plays 75%", kind: "num", fmt: fInt },
  { key: "v100", label: "Plays 100%", kind: "num", fmt: fInt },
  { key: "clicks", label: "Clicks", kind: "num", fmt: fInt },
  { key: "conversions", label: METRIC_LABEL.conversions, kind: "num", fmt: fInt },
  { key: "revenue", label: METRIC_LABEL.revenue, kind: "num", fmt: usd },
  // ── Offered, hidden by default (2026-11): LP views the query already sums,
  // three ratios of sums it carries, and the creative's own columns ──
  { key: "landingPageViews", label: METRIC_LABEL.landingPageViews, kind: "num", fmt: fInt },
  { key: "voc", label: METRIC_LABEL.voc, kind: "num", fmt: fPct },
  { key: "cpm", label: METRIC_LABEL.cpm, kind: "num", fmt: usd },
  { key: "cpc", label: METRIC_LABEL.cpc, kind: "num", fmt: usd },
  { key: "launchDate", label: "Launch date", kind: "date" },
  { key: "priority", label: "Priority", kind: "priority" },
  { key: "stages", label: "Stage", kind: "stages" },
  { key: "thumbnailUrl", label: "Thumbnail", kind: "url" },
];

const DEFAULT_VISIBLE = new Set<Key>([
  "productName", "spend", "hookRate", "holdRate", "completeRate", "cvr", "roas",
]);

/** The first-visit state, as the columns system states it: what is HIDDEN. */
const DEFAULT_HIDDEN = COLS.filter((c) => !DEFAULT_VISIBLE.has(c.key)).map((c) => c.key);
const COLUMN_KEYS = COLS.map((c) => c.key as string);

export function VideoDiagnosticsTable({
  rows,
  medianHookRate,
  medianHoldRate,
  medianCompleteRate,
}: {
  rows: VideoDiagnosticRow[];
  medianHookRate: number | null;
  medianHoldRate: number | null;
  medianCompleteRate: number | null;
}) {
  const searchParams = useSearchParams();
  const rangeFrom = searchParams.get("from");
  const rangeTo = searchParams.get("to");
  // Per user per brand (2026-10); the collapsed metric tail is the default.
  const cols = useTableColumns({
    tableKey: TABLE_KEYS.TRENDS_VIDEO,
    hideable: COLUMN_KEYS,
    defaults: COLUMN_KEYS,
    defaultHidden: DEFAULT_HIDDEN,
  });
  const [sortKey, setSortKey] = useState<string>("spend");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const columns = useMemo<DataColumn<VideoDiagnosticRow>[]>(() => {
    const medianFor = (m?: "hook" | "hold" | "complete") =>
      m === "hook"
        ? medianHookRate
        : m === "hold"
          ? medianHoldRate
          : m === "complete"
            ? medianCompleteRate
            : null;

    const nameCol: DataColumn<VideoDiagnosticRow> = {
      key: "name",
      label: "Video",
      align: "left",
      sortable: true,
      pinned: true,
      defaultSortDir: "asc",
      sortValue: (r) => r.name,
      render: (r) => (
        <Link
          href={withDateRange(
            `/library/${encodeURIComponent(r.name)}`,
            rangeFrom,
            rangeTo,
          )}
          className="text-ink hover:text-brand transition-colors truncate block max-w-[240px]"
        >
          {r.name}
        </Link>
      ),
    };

    const metricCols: DataColumn<VideoDiagnosticRow>[] = COLS.map((c) => ({
      key: c.key,
      label: c.label,
      align: c.kind === "num" ? "right" : "left",
      sortable: c.kind !== "url",
      defaultSortDir: c.kind === "num" || c.kind === "priority" ? "desc" : "asc",
      sortValue: (r) => {
        if (c.kind === "status") return STATUS_ORDER[r.status];
        if (c.kind === "text") return String(r[c.key] ?? "");
        // Unset sorts as null, which the primitive sinks in both directions.
        if (c.kind === "date") return r.launchDate;
        if (c.kind === "priority") return r.priority;
        if (c.kind === "stages") return r.stages.length ? r.stages.join(", ") : null;
        if (c.kind === "url") return null;
        return (r[c.key] as Num) ?? null;
      },
      csv:
        c.kind === "status"
          ? (r: VideoDiagnosticRow) => r.status
          : c.kind === "stages"
            ? (r: VideoDiagnosticRow) => r.stages.join(", ")
            : c.kind === "priority"
              ? (r: VideoDiagnosticRow) => r.priority
              : c.kind === "date"
                ? (r: VideoDiagnosticRow) => r.launchDate
                : c.kind === "url"
                  ? (r: VideoDiagnosticRow) => r.thumbnailUrl
                  : undefined,
      render: (r) => {
        if (c.kind === "status") return <StatusBadge status={r.status} />;
        if (c.kind === "text")
          return <span className="text-ink-2">{String(r[c.key] ?? DASH)}</span>;
        if (c.kind === "date")
          return <span className="whitespace-nowrap text-ink-2">{isoDate(r.launchDate)}</span>;
        if (c.kind === "priority") return <PriorityStars value={r.priority} />;
        if (c.kind === "stages") return <StageChips stages={r.stages} />;
        if (c.kind === "url") return <ExternalCell url={r.thumbnailUrl} />;
        const v = r[c.key] as Num;
        const med = medianFor(c.median);
        const below = c.median && v !== null && med !== null && v < med;
        return <span className={below ? "text-warn" : "text-ink"}>{c.fmt!(v)}</span>;
      },
    }));

    return [nameCol, ...metricCols];
  }, [medianHookRate, medianHoldRate, medianCompleteRate, rangeFrom, rangeTo]);


  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-ink-3">
          {rows.length} video{rows.length === 1 ? "" : "s"} · rates below the median are amber
        </span>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.creativeId}
        sort={sortKey}
        dir={dir}
        {...cols.tableProps}
        csvFileName="video-diagnostics"
        onSort={(key, d) => {
          setSortKey(key);
          setDir(d);
        }}
        minWidthClass="min-w-[760px]"
        empty={<EmptyState title="No video creatives in this window." kind="filtered" />}
      />
    </div>
  );
}
