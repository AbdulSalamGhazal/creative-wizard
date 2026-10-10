"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { withDateRange } from "@/lib/url";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { TABLE_KEYS } from "@/lib/table-columns";
import { int, pct, roas, usd } from "@/lib/format";
import { METRIC_LABEL } from "@/lib/metric-labels";
import { StatusBadge } from "@/components/creative/status-badge";
import { STATUS_ORDER } from "@/lib/creative-status";
import type { VideoDiagnosticRow } from "@/db/queries/trends";

const DASH = "—";
type Num = number | null;
const fUsd = (v: Num) => (v === null ? DASH : usd(v));
const fPct = (v: Num) => (v === null ? DASH : pct(v));
const fRatio = (v: Num) => roas(v);
const fInt = (v: Num) => (v === null ? DASH : int(v));

type Key = Exclude<keyof VideoDiagnosticRow, "creativeId" | "name">;

interface Col {
  key: Key;
  label: string;
  kind: "num" | "text" | "status";
  fmt?: (v: Num) => string;
  /** Flag amber when below this median (the funnel-rate columns). */
  median?: "hook" | "hold" | "complete";
}

const COLS: Col[] = [
  { key: "productName", label: "Product", kind: "text" },
  { key: "status", label: "Status", kind: "status" },
  { key: "spend", label: "Spend", kind: "num", fmt: fUsd },
  { key: "impressions", label: METRIC_LABEL.impressions, kind: "num", fmt: fInt },
  { key: "hookRate", label: "Hook", kind: "num", fmt: fPct, median: "hook" },
  { key: "ret25", label: "25%", kind: "num", fmt: fPct },
  { key: "holdRate", label: "Hold (50%)", kind: "num", fmt: fPct, median: "hold" },
  { key: "ret75", label: "75%", kind: "num", fmt: fPct },
  { key: "completeRate", label: "Complete", kind: "num", fmt: fPct, median: "complete" },
  { key: "ctr", label: "CTR", kind: "num", fmt: fPct },
  { key: "cvr", label: "CvR", kind: "num", fmt: fPct },
  { key: "cpa", label: "CPA", kind: "num", fmt: fUsd },
  { key: "roas", label: "ROAS", kind: "num", fmt: fRatio },
  { key: "costPerHook", label: "Cost/hook", kind: "num", fmt: fUsd },
  { key: "costPerCompletion", label: "Cost/compl.", kind: "num", fmt: fUsd },
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
      sortable: true,
      defaultSortDir: c.kind === "num" ? "desc" : "asc",
      sortValue: (r) => {
        if (c.kind === "status") return STATUS_ORDER[r.status];
        if (c.kind === "text") return String(r[c.key] ?? "");
        return (r[c.key] as Num) ?? null;
      },
      csv: c.kind === "status" ? (r: VideoDiagnosticRow) => r.status : undefined,
      render: (r) => {
        if (c.kind === "status") return <StatusBadge status={r.status} />;
        if (c.kind === "text")
          return <span className="text-ink-2">{String(r[c.key] ?? DASH)}</span>;
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
        empty={
          <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-12 text-center">
            <p className="text-ink-2 text-sm">No video creatives in this window.</p>
          </div>
        }
      />
    </div>
  );
}
