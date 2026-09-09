"use client";

import { useMemo } from "react";
import { Wallet } from "lucide-react";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { PlatformDot } from "@/components/ui/platform-dot";
import { PLATFORM_LABEL } from "@/lib/palette";
import { signedPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  BUDGET_OBJECTIVES,
  curveExpected,
  pacingDeviation,
  pacingTone,
  pacingVerdict,
  spendInDisplayCurrency,
  variance,
  variancePct,
} from "@/lib/budget";
import type { BudgetMonthData } from "@/db/queries/budget";
import { formatSpend, type BudgetCurrency } from "@/components/budget/budget-shared";

interface CheckRow {
  key: string;
  kind: "objective" | "combo";
  objective: string;
  platform: string | null;
  planned: number;
  actual: number;
  /** Actual spend on a combo with no allocation — the reserve's territory. */
  unplanned: boolean;
}

const comboKey = (o: string, p: string) => `${o}|${p}`;

/**
 * The allocation check: did the month's money land where the plan put it?
 * Grouped by Budget's own objective buckets, each with its platforms beneath,
 * plan vs actual side by side, and "unplanned" rows for combos that spent
 * without an allocation.
 *
 * The unplanned rows are the point of the invariant, not decoration: the Actual
 * total here must equal the month's RAW `performance_records` total exactly
 * (no exclusion filtering — the module's standing decision), so money can never
 * quietly fall outside the table.
 */
export function BudgetAllocationCheck({
  month,
  data,
  currency,
  elapsedDays,
  isCurrentMonth,
}: {
  month: string;
  data: BudgetMonthData;
  currency: BudgetCurrency;
  elapsedDays: number;
  isCurrentMonth: boolean;
}) {
  const rate = data.usdToSarRate;
  const fmtSpend = (usdAmount: number) => formatSpend(usdAmount, currency, rate);
  const weights = data.dayWeightOverrides;

  const rows: CheckRow[] = useMemo(() => {
    const planned = new Map(
      data.allocations.map((a) => [comboKey(a.objective, a.platform), a.plannedSpend]),
    );
    const actual = new Map(
      data.actualSpendByCombo.map((c) => [comboKey(c.objective, c.platform), c.actualSpend]),
    );

    const out: CheckRow[] = [];
    for (const objective of BUDGET_OBJECTIVES) {
      const combos = new Set<string>();
      for (const k of planned.keys()) if (k.startsWith(`${objective}|`)) combos.add(k);
      for (const k of actual.keys()) if (k.startsWith(`${objective}|`)) combos.add(k);
      if (combos.size === 0) continue;
      const children: CheckRow[] = [...combos]
        .map((k) => ({
          key: k,
          kind: "combo" as const,
          objective,
          platform: k.split("|")[1]!,
          planned: planned.get(k) ?? 0,
          actual: actual.get(k) ?? 0,
          unplanned: !planned.has(k),
        }))
        .sort((a, b) => (a.platform! < b.platform! ? -1 : 1));
      out.push({
        key: objective,
        kind: "objective",
        objective,
        platform: null,
        planned: children.reduce((s, c) => s + c.planned, 0),
        actual: children.reduce((s, c) => s + c.actual, 0),
        unplanned: false,
      });
      out.push(...children);
    }
    return out;
  }, [data.allocations, data.actualSpendByCombo]);

  const totals = useMemo(() => {
    const combos = rows.filter((r) => r.kind === "combo");
    return {
      planned: combos.reduce((s, r) => s + r.planned, 0),
      actual: combos.reduce((s, r) => s + r.actual, 0),
    };
  }, [rows]);

  const totalDeviation = isCurrentMonth
    ? pacingDeviation(
        totals.actual,
        curveExpected(totals.planned, month, weights, elapsedDays),
      )
    : null;

  const devCell = (dev: number | null) => (
    <span className={cn("num text-xs", pacingTone(dev) === "warn" ? "text-warn" : "text-ink-3")}>
      {pacingVerdict(dev)}
    </span>
  );

  const columns: DataColumn<CheckRow>[] = useMemo(() => {
    const platformLabel = (r: CheckRow) =>
      PLATFORM_LABEL[r.platform as keyof typeof PLATFORM_LABEL] ?? r.platform ?? "";
    const rowDeviation = (r: CheckRow) =>
      pacingDeviation(r.actual, curveExpected(r.planned, month, weights, elapsedDays));

    return [
      {
        key: "item",
        label: "Objective / platform",
        pinned: true,
        render: (r) =>
          r.kind === "objective" ? (
            <span className="font-medium">{r.objective}</span>
          ) : (
            <span className="inline-flex items-center gap-2 pl-6">
              <PlatformDot platform={r.platform as never} size="sm" />
              {platformLabel(r)}
              {r.unplanned && (
                <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-3">
                  unplanned
                </span>
              )}
            </span>
          ),
        csv: (r) =>
          r.kind === "objective"
            ? r.objective
            : `  ${platformLabel(r)}${r.unplanned ? " (unplanned)" : ""}`,
        total: () => <span className="text-ink-3">Total</span>,
      },
      {
        key: "planned",
        label: `Planned (${currency})`,
        align: "right",
        render: (r) => (
          <span className="num tabular-nums">
            {r.unplanned && r.planned === 0 ? "—" : fmtSpend(r.planned)}
          </span>
        ),
        csv: (r) => spendInDisplayCurrency(r.planned, currency, rate).toFixed(2),
        total: () => (
          <span className="num tabular-nums font-semibold">{fmtSpend(totals.planned)}</span>
        ),
      },
      {
        key: "actual",
        label: `Actual (${currency})`,
        align: "right",
        render: (r) => <span className="num tabular-nums">{fmtSpend(r.actual)}</span>,
        csv: (r) => spendInDisplayCurrency(r.actual, currency, rate).toFixed(2),
        total: () => (
          <span className="num tabular-nums font-semibold">{fmtSpend(totals.actual)}</span>
        ),
      },
      ...(isCurrentMonth
        ? [
            {
              key: "pacing",
              label: "Pacing",
              align: "right" as const,
              render: (r: CheckRow) => devCell(rowDeviation(r)),
              csv: (r: CheckRow) => pacingVerdict(rowDeviation(r)),
              total: () => devCell(totalDeviation),
            },
          ]
        : []),
      {
        key: "variance",
        label: `Variance (${currency})`,
        align: "right",
        render: (r) => {
          const v = variance(r.actual, r.planned);
          return (
            <span className="num tabular-nums text-ink-2">
              {v > 0 ? "+" : v < 0 ? "−" : ""}
              {fmtSpend(Math.abs(v))}
            </span>
          );
        },
        csv: (r) => spendInDisplayCurrency(variance(r.actual, r.planned), currency, rate).toFixed(2),
        total: () => {
          const v = variance(totals.actual, totals.planned);
          return (
            <span className="num tabular-nums font-semibold text-ink-2">
              {v > 0 ? "+" : v < 0 ? "−" : ""}
              {fmtSpend(Math.abs(v))}
            </span>
          );
        },
      },
      {
        key: "variance_pct",
        label: "Variance %",
        align: "right",
        render: (r) => (
          <span className="num tabular-nums text-ink-3">
            {signedPct(variancePct(r.actual, r.planned))}
          </span>
        ),
        csv: (r) => {
          const pct = variancePct(r.actual, r.planned);
          return pct === null ? "" : (pct * 100).toFixed(1);
        },
        total: () => (
          <span className="num tabular-nums font-semibold text-ink-3">
            {signedPct(variancePct(totals.actual, totals.planned))}
          </span>
        ),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency, rate, totals, isCurrentMonth, elapsedDays, month, weights, totalDeviation]);

  return (
    <DataTable<CheckRow>
      columns={columns}
      rows={rows}
      rowKey={(r) => r.key}
      showTotals={rows.length > 0}
      minWidthClass="min-w-[720px]"
      csvFileName={`budget-allocations-${month}-${currency.toLowerCase()}`}
      rowClassName={(r) =>
        cn(r.kind === "objective" && "bg-surface-2/50 font-medium", r.unplanned && "opacity-70")
      }
      empty={
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <Wallet className="h-6 w-6 text-ink-3" />
          <p className="text-sm text-ink-2">Nothing planned or spent this month.</p>
        </div>
      }
    />
  );
}
