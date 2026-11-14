"use client";

import { useMemo } from "react";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoTip } from "@/components/ui/info-tip";
import { PlatformDot } from "@/components/ui/platform-dot";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { int, pct1, roas as fmtRoas } from "@/lib/format";
import { TABLE_KEYS } from "@/lib/table-columns";
import { combineResults, round2 } from "@/lib/budget";
import type { ResultDimension, ResultRow } from "@/lib/budget-results";
import { ResultShares } from "@/components/budget/result-shares";
import { ResultsBubble } from "@/components/budget/charts/results-bubble";

const NOUN: Record<ResultDimension, string> = {
  platform: "platform",
  objective: "objective",
  product: "product",
};

/**
 * Analysis → the RESULTS lens (2026-11-14): where the money went and what the
 * platforms say it bought, by platform, objective or product — a bubble chart
 * (spend against ROAS, sized by purchases), the share comparison, and the
 * table behind both. Platform-reported and raw throughout; never beside store
 * revenue, no targets, no verdict colours.
 */
export function ResultsLens({
  rows,
  by,
  onBy,
  title,
  fmt,
  fmtCents,
  toDisplay,
  compact,
  csvName,
}: {
  rows: readonly ResultRow[];
  by: ResultDimension;
  onBy: (by: ResultDimension) => void;
  /** The range, in words. */
  title: string;
  fmt: (usd: number) => string;
  fmtCents: (usd: number) => string;
  toDisplay: (usd: number) => number;
  compact: (usd: number) => string;
  csvName: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl<ResultDimension>
          ariaLabel="Results by"
          value={by}
          onChange={onBy}
          options={[
            { value: "platform", label: "Platform" },
            { value: "objective", label: "Objective" },
            { value: "product", label: "Product" },
          ]}
        />
        <InfoTip label="About these figures">
          Purchases, purchase value, ROAS and cost per purchase are what the ad platforms report,
          over raw records (exclusions don&rsquo;t apply in Budget). They are the platforms&rsquo;
          own claims — the store&rsquo;s ROAS is on the Pacing lens.
          {by === "product" &&
            " Products have no plan: budgets are planned by platform and objective, so there is no pace to show here."}
        </InfoTip>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Nothing was spent in this range." buttons={false} />
      ) : (
        <>
          <ResultsBubble
            rows={rows}
            title={title}
            toDisplay={toDisplay}
            fmt={fmt}
            fmtCents={fmtCents}
            compact={compact}
          />
          <ResultShares rows={rows} noun={NOUN[by]} />
          <ResultsTable
            rows={rows}
            by={by}
            fmt={fmt}
            fmtCents={fmtCents}
            toDisplay={toDisplay}
            csvName={`${csvName}-by-${by}`}
          />
        </>
      )}
    </div>
  );
}

function ResultsTable({
  rows,
  by,
  fmt,
  fmtCents,
  toDisplay,
  csvName,
}: {
  rows: readonly ResultRow[];
  by: ResultDimension;
  fmt: (usd: number) => string;
  fmtCents: (usd: number) => string;
  toDisplay: (usd: number) => number;
  csvName: string;
}) {
  const columns: DataColumn<ResultRow>[] = useMemo(() => {
    const money = (usd: number | null) => (usd === null ? null : round2(toDisplay(usd)));
    const dash = <span className="text-ink-3">—</span>;
    const share = (v: number | null) =>
      v === null ? dash : <span className="tabular-nums">{pct1(v)}</span>;
    const total = combineResults(rows.map((r) => ({ spend: r.spend, results: r.results })));
    const spendTotal = rows.reduce((s, r) => s + r.spend, 0);
    return [
      {
        key: "item",
        label: by === "platform" ? "Platform" : by === "objective" ? "Objective" : "Product",
        pinned: true,
        sortable: true,
        defaultSortDir: "asc",
        sortValue: (r) => r.label,
        csv: (r) => r.label,
        render: (r) => (
          <span className="inline-flex max-w-[11rem] items-center gap-1.5 sm:max-w-[18rem]">
            {r.platform && <PlatformDot platform={r.platform} />}
            <span className="truncate" title={r.label}>
              {r.label}
            </span>
          </span>
        ),
        total: () => <span className="text-ink-3">Total</span>,
      },
      {
        key: "spend",
        label: "Spend",
        align: "right",
        sortable: true,
        sortValue: (r) => r.spend,
        csv: (r) => money(r.spend),
        render: (r) => <span className="tabular-nums">{fmt(r.spend)}</span>,
        total: () => <span className="tabular-nums">{fmt(spendTotal)}</span>,
      },
      {
        key: "spendShare",
        label: "Share of spend",
        align: "right",
        sortable: true,
        sortValue: (r) => r.spendShare,
        csv: (r) => (r.spendShare === null ? null : Math.round(r.spendShare * 1000) / 10),
        render: (r) => share(r.spendShare),
        info: "Over the spend that reports purchases.",
      },
      {
        key: "purchases",
        label: "Purchases (platform)",
        align: "right",
        sortable: true,
        sortValue: (r) => r.results.purchases,
        csv: (r) => r.results.purchases,
        render: (r) => <span className="tabular-nums">{int(r.results.purchases)}</span>,
        total: () => <span className="tabular-nums">{int(total.purchases)}</span>,
      },
      {
        key: "purchaseShare",
        label: "Share of purchases",
        align: "right",
        sortable: true,
        sortValue: (r) => r.purchaseShare,
        csv: (r) => (r.purchaseShare === null ? null : Math.round(r.purchaseShare * 1000) / 10),
        render: (r) => share(r.purchaseShare),
      },
      {
        key: "gap",
        label: "Gap (pt)",
        align: "right",
        sortable: true,
        sortValue: (r) => r.gapPts,
        csv: (r) => (r.gapPts === null ? null : Math.round(r.gapPts * 10) / 10),
        render: (r) =>
          r.gapPts === null ? (
            dash
          ) : (
            <span className="tabular-nums">
              {r.gapPts > 0.05 ? "+" : r.gapPts < -0.05 ? "−" : ""}
              {Math.abs(r.gapPts).toFixed(1)}
            </span>
          ),
        info: "Share of purchases minus share of spend, in percentage points.",
      },
      {
        key: "roas",
        label: "ROAS (platform)",
        align: "right",
        sortable: true,
        sortValue: (r) => r.results.roas,
        csv: (r) => (r.results.roas === null ? null : Math.round(r.results.roas * 100) / 100),
        render: (r) => <span className="tabular-nums">{fmtRoas(r.results.roas)}</span>,
        total: () => <span className="tabular-nums">{fmtRoas(total.roas)}</span>,
      },
      {
        key: "cpa",
        label: "CPA (platform)",
        align: "right",
        sortable: true,
        sortValue: (r) => r.results.cpa,
        csv: (r) => money(r.results.cpa),
        render: (r) =>
          r.results.cpa === null ? dash : <span className="tabular-nums">{fmtCents(r.results.cpa)}</span>,
        total: () =>
          total.cpa === null ? dash : <span className="tabular-nums">{fmtCents(total.cpa)}</span>,
      },
      {
        key: "value",
        label: "Purchase value (platform)",
        align: "right",
        sortable: true,
        sortValue: (r) => r.results.purchaseValue,
        csv: (r) => money(r.results.purchaseValue),
        render: (r) =>
          r.results.purchaseValue === null ? (
            dash
          ) : (
            <span className="tabular-nums">{fmt(r.results.purchaseValue)}</span>
          ),
        total: () =>
          total.purchaseValue === null ? dash : <span className="tabular-nums">{fmt(total.purchaseValue)}</span>,
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, by, csvName]);
  const keys = columns.filter((c) => !c.pinned).map((c) => c.key);
  const cols = useTableColumns({
    tableKey: TABLE_KEYS.BUDGET_RESULTS,
    hideable: keys,
    defaults: keys,
    defaultHidden: ["value"],
  });
  return (
    <DataTable<ResultRow>
      columns={columns}
      {...cols.tableProps}
      rows={[...rows]}
      rowKey={(r) => r.key}
      sort="spend"
      dir="desc"
      showTotals
      minWidthClass="min-w-[860px]"
      csvFileName={csvName}
    />
  );
}
