"use client";

import { useMemo, useState, type ReactNode } from "react";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { TABLE_KEYS } from "@/lib/table-columns";
import { Sparkline } from "@/components/charts/sparkline";
import { StatusBadge } from "@/components/creative/status-badge";
import { int, pct, roas, usd } from "@/lib/format";
import { METRIC_LABEL } from "@/lib/metric-labels";
import { TYPE_LABEL } from "@/lib/palette";
import { cn } from "@/lib/utils";
import type { LeaderboardRow } from "@/db/queries/performance";
import { EmptyState } from "@/components/ui/empty-state";

type Num = number | null;
const fPct = (v: Num) => (v === null ? "—" : pct(v));
const fRatio = (v: Num) => roas(v);

type ColKey =
  | "product"
  | "type"
  | "status"
  | "spend"
  | "cpm"
  | "impressions"
  | "clicks"
  | "ctr"
  | "voc"
  | "conversions"
  | "cvr"
  | "roas"
  | "revenue"
  | "cpa"
  | "trend";

interface Col {
  key: ColKey;
  label: string;
  align: "left" | "right";
  /** Default-visible. */
  on: boolean;
  render: (r: LeaderboardRow) => ReactNode;
  csv?: (r: LeaderboardRow) => string | number | null;
}

/**
 * The non-identity columns, in display order. Default-visible set per the
 * dashboard spec: Product · Status · Spend · CPM · CTR · VOC · CvR · CPA ·
 * ROAS · Trend — the rest are one click away in the table's own corner
 * control. (Creative is the pinned identity column and lives in `columns`
 * below, with the rank number folded into it.)
 */
const COLS: Col[] = [
  { key: "product", label: "Product", align: "left", on: true, render: (r) => <span className="text-ink-2">{r.productName}</span>, csv: (r) => r.productName },
  { key: "type", label: "Type", align: "left", on: false, render: (r) => <span className="text-ink-2">{TYPE_LABEL[r.type]}</span>, csv: (r) => TYPE_LABEL[r.type] },
  { key: "status", label: "Status", align: "left", on: true, render: (r) => <StatusBadge status={r.status} />, csv: (r) => r.status },
  { key: "spend", label: "Spend", align: "right", on: true, render: (r) => <span className="text-ink">{usd(r.spend)}</span>, csv: (r) => r.spend },
  { key: "cpm", label: "CPM", align: "right", on: true, render: (r) => <span className="text-ink-2">{usd(r.cpm)}</span>, csv: (r) => r.cpm },
  { key: "impressions", label: METRIC_LABEL.impressions, align: "right", on: false, render: (r) => <span className="text-ink-2">{int(r.impressions)}</span>, csv: (r) => r.impressions },
  { key: "clicks", label: "Clicks", align: "right", on: false, render: (r) => <span className="text-ink-2">{int(r.clicks)}</span>, csv: (r) => r.clicks },
  { key: "ctr", label: "CTR", align: "right", on: true, render: (r) => <span className="text-ink-2">{fPct(r.ctr)}</span>, csv: (r) => r.ctr },
  { key: "voc", label: "VOC", align: "right", on: true, render: (r) => <span className="text-ink-2">{fPct(r.voc)}</span>, csv: (r) => r.voc },
  { key: "conversions", label: METRIC_LABEL.conversions, align: "right", on: false, render: (r) => <span className="text-ink-2">{int(r.conversions)}</span>, csv: (r) => r.conversions },
  { key: "cvr", label: "CvR", align: "right", on: true, render: (r) => <span className="text-ink-2">{fPct(r.cvr)}</span>, csv: (r) => r.cvr },
  { key: "cpa", label: "CPA", align: "right", on: true, render: (r) => <span className="text-ink-2">{usd(r.cpa)}</span>, csv: (r) => r.cpa },
  { key: "roas", label: "ROAS", align: "right", on: true, render: (r) => <span className="text-ink">{fRatio(r.roas)}</span>, csv: (r) => r.roas },
  { key: "revenue", label: METRIC_LABEL.revenue, align: "right", on: false, render: (r) => <span className="text-ink-2">{usd(r.conversionValue)}</span>, csv: (r) => r.conversionValue },
  { key: "trend", label: "Trend", align: "left", on: true, render: (r) => <Sparkline values={r.sparkline} color="var(--brand-2)" responsive height={24} />, csv: () => null },
];

/** The first-visit state, in the columns system's own terms: what is HIDDEN. */
const DEFAULT_HIDDEN = COLS.filter((c) => !c.on).map((c) => c.key as string);
const COLUMN_KEYS = COLS.map((c) => c.key as string);

/**
 * The RANKING control — not a columns control and not a sort header. It picks
 * which metric decides "top", and `lower` flags the cost metric (CPM) so top
 * means cheapest rather than most expensive. Each option names the column it
 * ranks by, which is then force-shown.
 */
const RANK_OPTIONS: Array<{
  key: string;
  label: string;
  col: ColKey;
  pick: (r: LeaderboardRow) => number | null;
  lower?: boolean;
}> = [
  { key: "spend", label: "Spend", col: "spend", pick: (r) => r.spend },
  { key: "cpm", label: "CPM", col: "cpm", pick: (r) => r.cpm, lower: true },
  { key: "ctr", label: "CTR", col: "ctr", pick: (r) => r.ctr },
  { key: "voc", label: "VOC", col: "voc", pick: (r) => r.voc },
  { key: "cvr", label: "CvR", col: "cvr", pick: (r) => r.cvr },
  { key: "roas", label: "ROAS", col: "roas", pick: (r) => r.roas },
];

/**
 * EXPORTED for the unit test: the leaderboard's own ordering. Rows WITHOUT the
 * ranked metric sort last whichever way the metric points (an unreported
 * metric is missing information, not a bad score), and only then is the list
 * cut to `limit`.
 */
export function rankRows(
  rows: LeaderboardRow[],
  opt: (typeof RANK_OPTIONS)[number],
  limit: number,
): LeaderboardRow[] {
  const withVal = rows.filter((r) => opt.pick(r) !== null);
  const without = rows.filter((r) => opt.pick(r) === null);
  withVal.sort((a, b) =>
    opt.lower ? opt.pick(a)! - opt.pick(b)! : opt.pick(b)! - opt.pick(a)!,
  );
  return [...withVal, ...without].slice(0, limit);
}

/**
 * The dashboard's Top-creatives leaderboard, on the shared `DataTable`.
 *
 * TWO CONTROLS, TWO JOBS, and the migration keeps them apart: the segmented
 * control picks what "top" MEANS (a view control, page-owned, never a column),
 * and the table's own corner control picks which columns show (shared, per
 * user per brand). Nothing in the header sorts — the ranking is the order.
 *
 * The metric being ranked by is FORCE-SHOWN (`lockedVisible`) however the
 * columns are set, so you can always see what you sorted on; the control
 * renders that row without a checkbox for as long as it is the active rank.
 */
export function TopCreativesTable({
  rows,
  limit = 10,
}: {
  rows: LeaderboardRow[];
  limit?: number;
}) {
  const [rankBy, setRankBy] = useState("spend");
  const opt = RANK_OPTIONS.find((o) => o.key === rankBy) ?? RANK_OPTIONS[0]!;

  const ranked = useMemo(() => rankRows(rows, opt, limit), [rows, opt, limit]);
  /** Position in the ranked list — folded into the identity cell, which is
   *  pinned, so the number stays beside the name during horizontal scroll. */
  const rankOf = useMemo(
    () => new Map(ranked.map((r, i) => [r.creativeId, i + 1])),
    [ranked],
  );

  const columns = useMemo<DataColumn<LeaderboardRow>[]>(
    () => [
      {
        key: "name",
        label: "Creative",
        align: "left",
        pinned: true,
        render: (r) => (
          // CAPPED, like the 220px the old `table-fixed` colgroup gave it: the
          // pinned column is sticky, so if it grows past the visible frame it
          // can no longer pin — on a phone the rank and the first characters
          // scroll off the left edge. A cap is what makes `truncate` fire.
          <span className="flex min-w-0 max-w-[14rem] items-baseline gap-2">
            <span className="w-4 shrink-0 text-right text-ink-3 tabular-nums">
              {rankOf.get(r.creativeId)}
            </span>
            <span className="truncate font-mono text-xs text-ink" title={r.name}>
              {r.name}
            </span>
          </span>
        ),
        csv: (r) => r.name,
      },
      ...COLS.map<DataColumn<LeaderboardRow>>((c) => ({
        key: c.key,
        label: c.label,
        align: c.align,
        render: c.render,
        csv: c.csv,
        // The ranked metric can't be hidden while it IS the ranking.
        lockedVisible: c.key === opt.col,
      })),
    ],
    [opt.col, rankOf],
  );

  const cols = useTableColumns({
    tableKey: TABLE_KEYS.TOP_CREATIVES,
    hideable: COLUMN_KEYS,
    defaults: COLUMN_KEYS,
    defaultHidden: DEFAULT_HIDDEN,
  });

  return (
    <div className="space-y-2.5">
      {/* Toolbar: title (left) · ranking metric (right). The COLUMNS control
          is not here any more — it lives in the table's own header row. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-semibold leading-none text-ink">Top creatives</h3>
          <span className="text-[11px] text-ink-3">spend ≥ $300</span>
        </div>
        <div className="inline-flex items-center rounded-md border border-line bg-surface-2 p-0.5 text-xs">
          {RANK_OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setRankBy(o.key)}
              className={cn(
                "rounded px-2.5 py-1 transition-colors",
                rankBy === o.key
                  ? "bg-surface text-ink shadow-sm"
                  : "text-ink-3 hover:text-ink",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={ranked}
        rowKey={(r) => r.creativeId}
        {...cols.tableProps}
        minWidthClass="min-w-max"
        empty={
          <EmptyState
            className="h-48 flex flex-col items-center justify-center py-0"
            title="No creatives with ≥ $300 spend in this window."
            kind="filtered"
          />
        }
      />
    </div>
  );
}
