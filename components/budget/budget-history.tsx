"use client";

import { useMemo } from "react";
import { History } from "lucide-react";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { roas as fmtRoas, sar } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  monthLabel,
  roasThroughRate,
  spendInDisplayCurrency,
  variancePct,
} from "@/lib/budget";
import type { BudgetHistoryRow } from "@/db/queries/budget";
import {
  CurrencyToggle,
  formatSpend,
  useBudgetCurrency,
} from "@/components/budget/budget-shared";

/**
 * The Budget History page body — one read-only row per month that has a plan
 * or actuals, newest first. Spend columns follow the display-currency toggle;
 * ROAS always goes through the per-brand rate. Variance % is warn-tinted by
 * |magnitude| (over- and under- are both deviations — standing decision).
 */
export function BudgetHistory({
  rows,
  rate,
}: {
  rows: BudgetHistoryRow[];
  rate: number;
}) {
  const [currency, pickCurrency] = useBudgetCurrency();
  const fmtSpend = (usdAmount: number) => formatSpend(usdAmount, currency, rate);

  const totals = useMemo(
    () => ({
      plannedSpend: rows.reduce((s, r) => s + r.plannedSpend, 0),
      reserve: rows.reduce((s, r) => s + r.reserveSpendUsd, 0),
      actualSpend: rows.reduce((s, r) => s + r.actualSpend, 0),
      plannedRevenue: rows.reduce((s, r) => s + (r.plannedRevenueSar ?? 0), 0),
      actualRevenue: rows.reduce((s, r) => s + r.actualRevenueSar, 0),
    }),
    [rows],
  );

  const pctCell = (pct: number | null) => (
    <span
      className={cn(
        "num tabular-nums text-xs",
        pct !== null && Math.abs(pct) >= 0.15 ? "text-warn" : "text-ink-3",
      )}
    >
      {pct === null ? "—" : `${pct > 0 ? "+" : ""}${(pct * 100).toFixed(1)}%`}
    </span>
  );

  const columns: DataColumn<BudgetHistoryRow>[] = useMemo(
    () => [
      {
        key: "month",
        label: "Month",
        pinned: true,
        href: (r) => `/budget?month=${r.month}`,
        render: (r) => (
          <span className="font-medium text-ink hover:underline">{monthLabel(r.month)}</span>
        ),
        csv: (r) => r.month,
        sortValue: (r) => r.month,
        total: () => <span className="text-ink-3">Total</span>,
      },
      {
        key: "planned_spend",
        label: `Planned spend (${currency})`,
        align: "right",
        render: (r) => (
          <span className="num tabular-nums">
            {r.plannedSpend > 0 ? fmtSpend(r.plannedSpend) : "—"}
            {r.reserveSpendUsd > 0 && (
              <span className="text-ink-3"> +{fmtSpend(r.reserveSpendUsd)}</span>
            )}
          </span>
        ),
        csv: (r) => spendInDisplayCurrency(r.plannedSpend, currency, rate).toFixed(2),
        sortValue: (r) => r.plannedSpend,
        total: () => (
          <span className="num tabular-nums font-semibold">
            {fmtSpend(totals.plannedSpend)}
            {totals.reserve > 0 && (
              <span className="text-ink-3"> +{fmtSpend(totals.reserve)}</span>
            )}
          </span>
        ),
      },
      {
        key: "actual_spend",
        label: `Actual spend (${currency})`,
        align: "right",
        render: (r) => <span className="num tabular-nums">{fmtSpend(r.actualSpend)}</span>,
        csv: (r) => spendInDisplayCurrency(r.actualSpend, currency, rate).toFixed(2),
        sortValue: (r) => r.actualSpend,
        total: () => (
          <span className="num tabular-nums font-semibold">{fmtSpend(totals.actualSpend)}</span>
        ),
      },
      {
        key: "spend_variance",
        label: "Variance %",
        align: "right",
        render: (r) => pctCell(variancePct(r.actualSpend, r.plannedSpend)),
        csv: (r) => {
          const pct = variancePct(r.actualSpend, r.plannedSpend);
          return pct === null ? "" : (pct * 100).toFixed(1);
        },
        sortValue: (r) => variancePct(r.actualSpend, r.plannedSpend),
        total: () => pctCell(variancePct(totals.actualSpend, totals.plannedSpend)),
      },
      {
        key: "planned_revenue",
        label: "Planned revenue (SAR)",
        align: "right",
        render: (r) => (
          <span className="num tabular-nums">
            {r.plannedRevenueSar !== null ? sar(r.plannedRevenueSar) : "—"}
          </span>
        ),
        csv: (r) => (r.plannedRevenueSar !== null ? r.plannedRevenueSar.toFixed(2) : ""),
        sortValue: (r) => r.plannedRevenueSar,
        total: () => (
          <span className="num tabular-nums font-semibold">
            {totals.plannedRevenue > 0 ? sar(totals.plannedRevenue) : "—"}
          </span>
        ),
      },
      {
        key: "actual_revenue",
        label: "Actual revenue (SAR)",
        align: "right",
        render: (r) => <span className="num tabular-nums">{sar(r.actualRevenueSar)}</span>,
        csv: (r) => r.actualRevenueSar.toFixed(2),
        sortValue: (r) => r.actualRevenueSar,
        total: () => (
          <span className="num tabular-nums font-semibold">{sar(totals.actualRevenue)}</span>
        ),
      },
      {
        key: "revenue_variance",
        label: "Revenue variance %",
        align: "right",
        render: (r) =>
          pctCell(
            r.plannedRevenueSar !== null
              ? variancePct(r.actualRevenueSar, r.plannedRevenueSar)
              : null,
          ),
        csv: (r) => {
          const pct =
            r.plannedRevenueSar !== null
              ? variancePct(r.actualRevenueSar, r.plannedRevenueSar)
              : null;
          return pct === null ? "" : (pct * 100).toFixed(1);
        },
        sortValue: (r) =>
          r.plannedRevenueSar !== null
            ? variancePct(r.actualRevenueSar, r.plannedRevenueSar)
            : null,
        total: () =>
          pctCell(
            totals.plannedRevenue > 0
              ? variancePct(totals.actualRevenue, totals.plannedRevenue)
              : null,
          ),
      },
      {
        key: "roas",
        label: "ROAS (via rate)",
        align: "right",
        render: (r) => {
          const v = roasThroughRate(r.actualRevenueSar, r.actualSpend, rate);
          return <span className="num tabular-nums">{v === null ? "—" : fmtRoas(v)}</span>;
        },
        csv: (r) => {
          const v = roasThroughRate(r.actualRevenueSar, r.actualSpend, rate);
          return v === null ? "" : v.toFixed(2);
        },
        sortValue: (r) => roasThroughRate(r.actualRevenueSar, r.actualSpend, rate),
        total: () => {
          const v = roasThroughRate(totals.actualRevenue, totals.actualSpend, rate);
          return (
            <span className="num tabular-nums font-semibold">
              {v === null ? "—" : fmtRoas(v)}
            </span>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currency, rate, totals],
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <CurrencyToggle currency={currency} onChange={pickCurrency} />
      </div>
      <DataTable<BudgetHistoryRow>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.month}
        showTotals={rows.length > 0}
        minWidthClass="min-w-[860px]"
        csvFileName={`budget-history-${currency.toLowerCase()}`}
        empty={
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <History className="h-6 w-6 text-ink-3" />
            <p className="text-sm text-ink-2">No budget months yet.</p>
          </div>
        }
      />
    </div>
  );
}
