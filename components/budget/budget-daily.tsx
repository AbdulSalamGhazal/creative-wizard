"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipProps } from "recharts";
import { ChartHeader, ChartShell, ExpandButton } from "@/components/charts/chart-shell";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { MetricPicker } from "@/components/charts/metric-picker";
import { SeriesLegend } from "@/components/charts/series-legend";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { sar, sarCompact, usdCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  curveExpected,
  monthLabel,
  pacingDeviation,
  pacingTone,
  pacingVerdict,
  spendInDisplayCurrency,
  validateWeight,
} from "@/lib/budget";
import type { BudgetDailyRow, BudgetMonthData } from "@/db/queries/budget";
import {
  BudgetMonthBar,
  CurrencyToggle,
  HorizonNote,
  formatSpend,
  horizonDayInMonth,
  useBudgetCurrency,
} from "@/components/budget/budget-shared";

type Metric = "spend" | "revenue";

interface DailyTableRow {
  day: number;
  date: string;
  weight: number;
  /** Within the data horizon — actual figures are real (possibly genuinely 0). */
  known: boolean;
  spend: number;
  cumSpend: number;
  planToDate: number;
  spendDev: number | null;
  revenueSar: number;
  cumRevenueSar: number;
  targetToDate: number | null;
  revenueDev: number | null;
}

/**
 * The Budget Daily page body — one row per day of the month: raw spend and
 * store revenue vs the day-weight plan curve, plus a cumulative chart where
 * the dashed plan line steps up on weighted (payday) days. Days past the data
 * horizon render as em-dashes (unknown, not zero).
 */
export function BudgetDaily({
  month,
  today,
  data,
  daily,
  horizon,
}: {
  month: string; // YYYY-MM
  today: string; // ISO date
  data: BudgetMonthData;
  daily: BudgetDailyRow[];
  horizon: string | null;
}) {
  const [currency, pickCurrency] = useBudgetCurrency();
  const rate = data.usdToSarRate;
  const fmtSpend = (usdAmount: number) => formatSpend(usdAmount, currency, rate);

  const ov = data.dayWeightOverrides;
  const totalDays = daily.length;
  const horizonDay = horizonDayInMonth(month, horizon, totalDays);
  const plannedSpend = data.allocations.reduce((s, a) => s + a.plannedSpend, 0);
  const plannedRevenue = data.plannedRevenueSar;

  const rows: DailyTableRow[] = useMemo(() => {
    let cumSpend = 0;
    let cumRevenue = 0;
    return daily.map((d) => {
      const known = d.day <= horizonDay;
      if (known) {
        cumSpend += d.spend;
        cumRevenue += d.revenueSar;
      }
      const planToDate = curveExpected(plannedSpend, month, ov, d.day);
      const targetToDate =
        plannedRevenue !== null ? curveExpected(plannedRevenue, month, ov, d.day) : null;
      const w = ov[d.day];
      return {
        day: d.day,
        date: d.date,
        weight: w !== undefined && validateWeight(w) ? w : 1,
        known,
        spend: d.spend,
        cumSpend,
        planToDate,
        spendDev: known && plannedSpend > 0 ? pacingDeviation(cumSpend, planToDate) : null,
        revenueSar: d.revenueSar,
        cumRevenueSar: cumRevenue,
        targetToDate,
        revenueDev:
          known && targetToDate !== null ? pacingDeviation(cumRevenue, targetToDate) : null,
      };
    });
  }, [daily, horizonDay, plannedSpend, plannedRevenue, month, ov]);

  const last = rows.filter((r) => r.known).at(-1);

  // ── Cumulative chart ───────────────────────────────────────────────────────
  const [metric, setMetric] = useState<Metric>("spend");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const series = [
    { key: "actual", label: "Actual (cumulative)", color: "var(--brand)" },
    { key: "plan", label: metric === "spend" ? "Plan curve" : "Target curve", color: "var(--ink-3)" },
  ];
  const shown = new Set(series.filter((s) => !hidden.has(s.key)).map((s) => s.key));
  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const chartData = useMemo(
    () =>
      rows.map((r) => ({
        day: r.day,
        // Actual stops at the horizon (null → the line ends, not zero).
        actual: r.known
          ? metric === "spend"
            ? spendInDisplayCurrency(r.cumSpend, currency, rate)
            : r.cumRevenueSar
          : null,
        plan:
          metric === "spend"
            ? plannedSpend > 0
              ? spendInDisplayCurrency(r.planToDate, currency, rate)
              : null
            : r.targetToDate,
      })),
    [rows, metric, currency, rate, plannedSpend],
  );
  const fmtChart = (v: number) =>
    metric === "spend" ? (currency === "SAR" ? sar(v) : fmtSpend(v)) : sar(v);
  const fmtAxis = (v: number) =>
    metric === "revenue" || currency === "SAR" ? sarCompact(v) : usdCompact(v);

  const devCell = (dev: number | null) => (
    <span className={cn("num text-xs", pacingTone(dev) === "warn" ? "text-warn" : "text-ink-3")}>
      {pacingVerdict(dev)}
    </span>
  );
  const dash = <span className="text-ink-3">—</span>;

  // ── Table columns ──────────────────────────────────────────────────────────
  const columns: DataColumn<DailyTableRow>[] = useMemo(
    () => [
      {
        key: "day",
        label: "Day",
        pinned: true,
        render: (r) => (
          <span className="inline-flex items-center gap-1.5">
            <span className="num tabular-nums">{r.day}</span>
            {r.weight > 1 && (
              <span
                className="h-1.5 w-1.5 rounded-full shrink-0"
                style={{ background: "var(--brand)" }}
                title={`Weighted day ×${r.weight}`}
                aria-label={`Weighted day ×${r.weight}`}
              />
            )}
          </span>
        ),
        csv: (r) => `${r.day}${r.weight > 1 ? ` (x${r.weight})` : ""}`,
        total: () => <span className="text-ink-3">Total</span>,
      },
      {
        key: "spend",
        label: `Spend (${currency})`,
        align: "right",
        render: (r) =>
          r.known ? <span className="num tabular-nums">{fmtSpend(r.spend)}</span> : dash,
        csv: (r) => (r.known ? spendInDisplayCurrency(r.spend, currency, rate).toFixed(2) : ""),
        total: () =>
          last ? (
            <span className="num tabular-nums font-semibold">{fmtSpend(last.cumSpend)}</span>
          ) : (
            dash
          ),
      },
      {
        key: "cum_spend",
        label: `Cumulative (${currency})`,
        align: "right",
        render: (r) =>
          r.known ? <span className="num tabular-nums">{fmtSpend(r.cumSpend)}</span> : dash,
        csv: (r) =>
          r.known ? spendInDisplayCurrency(r.cumSpend, currency, rate).toFixed(2) : "",
      },
      {
        key: "plan_to_date",
        label: `Plan-to-date (${currency})`,
        align: "right",
        render: (r) =>
          plannedSpend > 0 ? (
            <span className="num tabular-nums text-ink-3">{fmtSpend(r.planToDate)}</span>
          ) : (
            dash
          ),
        csv: (r) =>
          plannedSpend > 0
            ? spendInDisplayCurrency(r.planToDate, currency, rate).toFixed(2)
            : "",
        total: () =>
          plannedSpend > 0 ? (
            <span className="num tabular-nums font-semibold">{fmtSpend(plannedSpend)}</span>
          ) : (
            dash
          ),
      },
      {
        key: "spend_dev",
        label: "Spend deviation",
        align: "right",
        render: (r) => (r.known ? devCell(r.spendDev) : dash),
        csv: (r) => (r.known ? pacingVerdict(r.spendDev) : ""),
        total: () => (last ? devCell(last.spendDev) : dash),
      },
      {
        key: "revenue",
        label: "Revenue (SAR)",
        align: "right",
        render: (r) =>
          r.known ? <span className="num tabular-nums">{sar(r.revenueSar)}</span> : dash,
        csv: (r) => (r.known ? r.revenueSar.toFixed(2) : ""),
        total: () =>
          last ? (
            <span className="num tabular-nums font-semibold">{sar(last.cumRevenueSar)}</span>
          ) : (
            dash
          ),
      },
      {
        key: "cum_revenue",
        label: "Cumulative (SAR)",
        align: "right",
        render: (r) =>
          r.known ? <span className="num tabular-nums">{sar(r.cumRevenueSar)}</span> : dash,
        csv: (r) => (r.known ? r.cumRevenueSar.toFixed(2) : ""),
      },
      {
        key: "target_to_date",
        label: "Target-to-date (SAR)",
        align: "right",
        render: (r) =>
          r.targetToDate !== null ? (
            <span className="num tabular-nums text-ink-3">{sar(r.targetToDate)}</span>
          ) : (
            dash
          ),
        csv: (r) => (r.targetToDate !== null ? r.targetToDate.toFixed(2) : ""),
        total: () =>
          plannedRevenue !== null ? (
            <span className="num tabular-nums font-semibold">{sar(plannedRevenue)}</span>
          ) : (
            dash
          ),
      },
      {
        key: "revenue_dev",
        label: "Revenue deviation",
        align: "right",
        render: (r) => (r.known ? devCell(r.revenueDev) : dash),
        csv: (r) => (r.known ? pacingVerdict(r.revenueDev) : ""),
        total: () => (last ? devCell(last.revenueDev) : dash),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currency, rate, plannedSpend, plannedRevenue, last],
  );

  return (
    <div className="space-y-4">
      <BudgetMonthBar month={month} today={today}>
        <CurrencyToggle currency={currency} onChange={pickCurrency} />
      </BudgetMonthBar>

      {/* Cumulative chart — plan steps up on paydays; actual stops at horizon */}
      <ChartShell
        ariaLabel="Cumulative budget — expanded"
        legend={
          <SeriesLegend
            items={series}
            shown={shown}
            onToggle={toggle}
            onShowAll={() => setHidden(new Set())}
          />
        }
      >
        {({ inFull, toggleExpand }) => (
          <div className={inFull ? "flex flex-col h-full" : undefined}>
            <ChartHeader
              title={`Cumulative — ${monthLabel(month)}`}
              picker={
                <MetricPicker<Metric>
                  options={[
                    { value: "spend", label: "Spend" },
                    { value: "revenue", label: "Revenue" },
                  ]}
                  value={metric}
                  onChange={setMetric}
                />
              }
              controls={<ExpandButton inFull={inFull} onClick={toggleExpand} />}
            />
            <div className={inFull ? "flex-1 min-h-0" : "h-64"}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                    stroke="var(--line-2)"
                    tickMargin={6}
                  />
                  <YAxis
                    tickFormatter={fmtAxis}
                    tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                    stroke="var(--line-2)"
                    width={56}
                  />
                  <Tooltip
                    content={(p: TooltipProps<number, string>) => {
                      if (!p.active || !p.payload?.length) return null;
                      return (
                        <ChartTooltip>
                          <div className="font-medium text-ink mb-1">Day {p.label}</div>
                          {p.payload.map((entry) => (
                            <div key={entry.dataKey} className="flex items-center gap-2">
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ background: entry.color }}
                              />
                              <span className="text-ink-3">
                                {entry.dataKey === "actual" ? "Actual" : "Plan"}
                              </span>
                              <span className="num tabular-nums text-ink ml-auto">
                                {typeof entry.value === "number" ? fmtChart(entry.value) : "—"}
                              </span>
                            </div>
                          ))}
                        </ChartTooltip>
                      );
                    }}
                  />
                  {shown.has("plan") && (
                    <Line
                      type="linear"
                      dataKey="plan"
                      stroke="var(--ink-3)"
                      strokeWidth={1.6}
                      strokeDasharray="5 4"
                      dot={false}
                      activeDot={{ r: 3 }}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  )}
                  {shown.has("actual") && (
                    <Line
                      type="linear"
                      dataKey="actual"
                      stroke="var(--brand)"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </ChartShell>

      {/* Per-day table */}
      <DataTable<DailyTableRow>
        columns={columns}
        rows={rows}
        rowKey={(r) => String(r.day)}
        showTotals
        minWidthClass="min-w-[860px]"
        csvFileName={`budget-daily-${month}-${currency.toLowerCase()}`}
        rowClassName={(r) => cn(r.weight > 1 && "bg-[var(--brand-soft)]/40")}
      />

      <HorizonNote horizon={horizon} />
    </div>
  );
}
