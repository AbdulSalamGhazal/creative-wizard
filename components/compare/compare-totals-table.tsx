"use client";

import { useMemo } from "react";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { TABLE_KEYS } from "@/lib/table-columns";
import { COMPARE_COLORS } from "@/components/charts/compare-chart";
import { int, pct, roas, usd } from "@/lib/format";
import type { Kpis } from "@/db/queries/performance";

type MetricKey = Exclude<keyof Kpis, "funnelCpm" | "funnelCtr">;

type ColumnDef = {
  key: MetricKey;
  label: string;
  fmt: (v: number | null) => string;
  /** Stronger ink for the headline metrics. */
  strong?: boolean;
};

/**
 * Every metric the A/B totals table offers. `funnelCpm`/`funnelCtr` are
 * DELIBERATELY absent: they are `cpm`/`ctr` restricted to the platforms that
 * report a funnel, they exist for the dashboard's funnel-rates card alone, and
 * beside their unrestricted twins here they would read as a second, silently
 * different CPM. See `Kpis` for the rule.
 */
const COLUMNS: ColumnDef[] = [
  { key: "spend", label: "Spend", fmt: (v) => usd(v), strong: true },
  { key: "impressions", label: "Impressions", fmt: (v) => int(v) },
  { key: "clicks", label: "Clicks", fmt: (v) => int(v) },
  { key: "conversions", label: "Conversions", fmt: (v) => int(v) },
  { key: "conversionValue", label: "Conv. value", fmt: (v) => usd(v) },
  { key: "landingPageViews", label: "LP views", fmt: (v) => int(v) },
  { key: "ctr", label: "CTR", fmt: (v) => pct(v) },
  { key: "voc", label: "VOC", fmt: (v) => pct(v) },
  { key: "cvr", label: "CvR", fmt: (v) => pct(v) },
  { key: "cpm", label: "CPM", fmt: (v) => usd(v) },
  { key: "cpc", label: "CPC", fmt: (v) => usd(v) },
  { key: "cpa", label: "CPA", fmt: (v) => usd(v) },
  { key: "roas", label: "ROAS", fmt: (v) => roas(v), strong: true },
  { key: "hookRate", label: "Hook rate", fmt: (v) => pct(v) },
  { key: "holdRate", label: "Hold rate", fmt: (v) => pct(v) },
];

/** The metrics a first visit shows; the rest are one click away. */
const DEFAULT_VISIBLE: MetricKey[] = [
  "spend",
  "impressions",
  "ctr",
  "cvr",
  "cpa",
  "roas",
  "hookRate",
];
/** The same statement in the columns system's own terms: what is HIDDEN. */
const DEFAULT_HIDDEN = COLUMNS.filter(
  (c) => !DEFAULT_VISIBLE.includes(c.key),
).map((c) => c.key as string);

export interface CompareSideTotals {
  label: string;
  selection: string;
  totals: Kpis;
}

/**
 * The A/B totals table — one row per SIDE, on the shared `DataTable`.
 *
 * NOTHING SORTS HERE, on purpose: the rows are the comparison's two sides in
 * the order the page defines them, and re-ordering them by a metric would
 * break the pairing the colours, the chart and the controls all rely on. So no
 * column is `sortable` and the table takes no `onSort`.
 *
 * The columns control is the shared one (key `compare-totals`, per user per
 * brand). The old per-browser `compare-totals-cols` localStorage key is
 * retired and its values were NOT migrated, as the Library's and Store orders'
 * were not.
 */
export function CompareTotalsTable({ sides }: { sides: CompareSideTotals[] }) {
  const columns = useMemo<DataColumn<CompareSideTotals>[]>(
    () => [
      {
        key: "label",
        label: "Side",
        align: "left",
        pinned: true,
        render: (s) => (
          <span className="inline-flex items-center gap-2 whitespace-nowrap font-medium text-ink">
            <span
              className="h-2 w-2 shrink-0 rounded-sm"
              style={{
                background:
                  COMPARE_COLORS[sides.indexOf(s) % COMPARE_COLORS.length],
              }}
            />
            {s.label}
          </span>
        ),
        csv: (s) => s.label,
      },
      {
        key: "selection",
        label: "Selection",
        align: "left",
        render: (s) => (
          <span className="whitespace-nowrap text-xs text-ink-3">{s.selection}</span>
        ),
        csv: (s) => s.selection,
      },
      ...COLUMNS.map<DataColumn<CompareSideTotals>>((c) => ({
        key: c.key,
        label: c.label,
        align: "right",
        render: (s) => (
          <span className={c.strong ? "text-ink" : "text-ink-2"}>
            {c.fmt(s.totals[c.key])}
          </span>
        ),
        csv: (s) => s.totals[c.key],
      })),
    ],
    [sides],
  );

  const columnKeys = columns.filter((c) => !c.pinned).map((c) => c.key);
  const cols = useTableColumns({
    tableKey: TABLE_KEYS.COMPARE_TOTALS,
    hideable: columnKeys,
    defaults: columnKeys,
    defaultHidden: DEFAULT_HIDDEN,
  });

  return (
    <DataTable
      columns={columns}
      rows={sides}
      rowKey={(s) => s.label}
      {...cols.tableProps}
      minWidthClass="min-w-max"
      empty={
        <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-8 text-center text-sm text-ink-2">
          Pick a side to compare.
        </div>
      }
    />
  );
}
