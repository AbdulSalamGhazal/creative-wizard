"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Link from "@/components/nav/link";
import { usePathname, useRouter } from "@/lib/brand-nav";
import { useNavTransition } from "@/lib/nav-progress";
import { ChartHeader, ChartShell, ExpandButton, plotClass } from "@/components/charts/chart-shell";
import { CHART_CURSOR, ChartTooltip } from "@/components/charts/chart-tooltip";
import { SeriesLegend } from "@/components/charts/series-legend";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoTip } from "@/components/ui/info-tip";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { panelClass } from "@/components/ui/panel";
import { dateTimeLabel, roas as fmtRoas, sar0, sarCompact, signedPct, usdCompact } from "@/lib/format";
import { TABLE_KEYS } from "@/lib/table-columns";
import { monthLabel, round2, spendInDisplayCurrency } from "@/lib/budget";
import type { MonthReviewRow, ReviewSummary } from "@/lib/budget-review";
import type { PlanRevisionLogRow } from "@/db/queries/budget";
import type { ReviewSpan, ReviewView } from "@/validators/budget";
import {
  CurrencyToggle,
  Hero,
  PacingDevCell,
  formatSpend,
  useBudgetCurrency,
} from "@/components/budget/budget-shared";
import { useRememberedViews } from "@/components/budget/use-remembered-view";

const VIEW_DEFAULTS = { reviewview: "scorecard" };
/** "Aug 2026" — short enough for a chart tick and a pinned cell. */
const shortMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
};
const SERIES = [
  { key: "firstPlan", label: "First plan", color: "var(--line-2)" },
  { key: "plan", label: "Final plan", color: "var(--ink-3)" },
  { key: "actual", label: "Actual", color: "var(--brand)" },
];

/**
 * Budget → Review (2026-11-14, the restructure): the manager's page. How
 * close did each month land to its plan — against the plan it ended with AND
 * the plan it started with — did revenue and ROAS meet their targets, how
 * much reserve was drawn, and who changed the plan along the way. Closed
 * months are judged; the running month is shown to date.
 */
export function BudgetReview({
  rows,
  summary,
  log,
  rate,
  span,
  view,
  canManage,
}: {
  /** Oldest first. */
  rows: MonthReviewRow[];
  summary: ReviewSummary;
  log: PlanRevisionLogRow[];
  rate: number;
  span: ReviewSpan;
  view: ReviewView;
  canManage: boolean;
}) {
  const [currency, pickCurrency] = useBudgetCurrency();
  const fmt = (usd: number) => formatSpend(usd, currency, rate, { whole: true });
  const toDisplay = (usd: number) => spendInDisplayCurrency(usd, currency, rate);
  const compact = (usd: number) => (currency === "SAR" ? sarCompact(toDisplay(usd)) : usdCompact(usd));
  const [views, setView] = useRememberedViews({ reviewview: view }, VIEW_DEFAULTS);
  const router = useRouter();
  const pathname = usePathname();
  const [, startNav] = useNavTransition();
  const setSpan = (v: ReviewSpan) =>
    startNav(() => router.replace(v === "12" ? pathname : `${pathname}?months=${v}`, { scroll: false }));

  const anyPlan = rows.some((r) => r.hasPlan);
  // Newest first where a person reads a list; oldest first on a time axis.
  const newestFirst = useMemo(() => [...rows].reverse(), [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl<ReviewSpan>
            ariaLabel="Months"
            value={span}
            onChange={setSpan}
            options={[
              { value: "6", label: "6 months" },
              { value: "12", label: "12 months" },
              { value: "24", label: "24 months" },
            ]}
          />
          <SegmentedControl<ReviewView>
            ariaLabel="View"
            value={views.reviewview as ReviewView}
            onChange={(v) => setView("reviewview", v)}
            options={[
              { value: "scorecard", label: "Scorecard" },
              { value: "table", label: "Table" },
            ]}
          />
        </div>
        <CurrencyToggle currency={currency} onChange={pickCurrency} />
      </div>

      {!anyPlan ? (
        <EmptyState
          title="No month in this window has a plan."
          hint={
            canManage ? (
              <p>
                Plan a month on the{" "}
                <Link href="/budget/plan" className="underline hover:text-ink">
                  Plan page
                </Link>{" "}
                and it will be judged here once it closes.
              </p>
            ) : (
              <p>Months appear here once they have a plan.</p>
            )
          }
          buttons={false}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 @2xl/main:grid-cols-3">
            <Hero
              label="Months on plan"
              value={summary.closed === 0 ? "—" : `${summary.onPlan} of ${summary.closed}`}
              aside={
                <InfoTip label="What counts as on plan">
                  Closed months whose spend landed within 15% of the plan they ended with. The
                  running month isn&rsquo;t judged until it closes.
                </InfoTip>
              }
              context="closed months within 15% of their final plan"
            />
            <Hero
              label="Spend vs final plan"
              value={summary.vsPlan === null ? "—" : signedPct(summary.vsPlan, 0)}
              context="all closed months together"
            />
            <Hero
              label="Spend vs first plan"
              value={summary.vsFirst === null ? "—" : signedPct(summary.vsFirst, 0)}
              aside={
                <InfoTip label="Why two baselines">
                  The first plan is the earliest one saved for a month. A plan revised late always
                  matches what was spent — the gap between these two figures is how far plans were
                  moved to meet reality.
                </InfoTip>
              }
              context="against the earliest plan saved for each month"
            />
          </div>

          {views.reviewview === "scorecard" ? (
            <>
              <MonthsChart rows={rows} toDisplay={toDisplay} fmt={fmt} compact={compact} />
              <Scorecard rows={newestFirst} fmt={fmt} />
            </>
          ) : (
            <MonthsTable
              rows={newestFirst}
              fmt={fmt}
              toDisplay={toDisplay}
              csvName={`budget-review-${rows[0]?.month}-to-${rows.at(-1)?.month}-${currency.toLowerCase()}`}
            />
          )}
        </>
      )}

      <RevisionLog log={log} fmt={fmt} />
    </div>
  );
}

// ── Chart ────────────────────────────────────────────────────────────────────

function MonthsChart({
  rows,
  toDisplay,
  fmt,
  compact,
}: {
  rows: MonthReviewRow[];
  toDisplay: (usd: number) => number;
  fmt: (usd: number) => string;
  compact: (usd: number) => string;
}) {
  const data = rows.map((r) => ({
    month: r.month,
    label: shortMonth(r.month).split(" ")[0],
    firstPlan: r.firstPlan === null ? null : round2(toDisplay(r.firstPlan)),
    plan: r.plan > 0 ? round2(toDisplay(r.plan)) : null,
    actual: round2(toDisplay(r.actual)),
    row: r,
  }));
  const perUsd = toDisplay(1) || 1;
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const shown = new Set(SERIES.filter((s) => !hidden.has(s.key)).map((s) => s.key));
  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <ChartShell
      summary={`Planned against actual spend by month: ${rows
        .map((r) => `${shortMonth(r.month)} ${fmt(r.actual)} of ${fmt(r.plan)}`)
        .join("; ")}.`}
      legend={<SeriesLegend items={SERIES} shown={shown} onToggle={toggle} />}
    >
      {({ inFull, toggleExpand }) => (
        <>
          <ChartHeader
            title="Planned against actual, by month"
            controls={<ExpandButton inFull={inFull} onClick={toggleExpand} />}
          />
          <div className={plotClass(inFull, "md")}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart accessibilityLayer data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }} barGap={2}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "var(--ink-3)", fontSize: 11 }} stroke="var(--line-2)" tickMargin={6} />
                <YAxis
                  tickFormatter={(v: number) => compact(v / perUsd)}
                  tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                  stroke="var(--line-2)"
                  width={56}
                />
                <Tooltip
                  cursor={CHART_CURSOR}
                  content={({ active, payload }) => {
                    const r = (payload?.[0]?.payload as { row: MonthReviewRow } | undefined)?.row;
                    if (!active || !r) return null;
                    return (
                      <ChartTooltip>
                        <div className="mb-1 font-medium text-ink">{monthLabel(r.month)}</div>
                        <p className="tabular-nums">Actual {fmt(r.actual)}</p>
                        <p className="tabular-nums text-ink-2">Final plan {r.plan > 0 ? fmt(r.plan) : "—"}</p>
                        {r.firstPlan !== null && (
                          <p className="tabular-nums text-ink-2">First plan {fmt(r.firstPlan)}</p>
                        )}
                        {r.state !== "final" && <p className="text-ink-2">in progress</p>}
                      </ChartTooltip>
                    );
                  }}
                />
                {SERIES.filter((s) => shown.has(s.key)).map((s) => (
                  <Bar key={s.key} dataKey={s.key} fill={s.color} isAnimationActive={false} radius={2} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </ChartShell>
  );
}

// ── Scorecard ────────────────────────────────────────────────────────────────

function Dev({ value }: { value: number | null }) {
  if (value === null) return <span className="text-ink-3">—</span>;
  return <PacingDevCell deviation={value} />;
}

function Scorecard({ rows, fmt }: { rows: MonthReviewRow[]; fmt: (usd: number) => string }) {
  return (
    <ul className="grid grid-cols-1 gap-2 @2xl/main:grid-cols-2 @5xl/main:grid-cols-3">
      {rows.map((r) => {
        const live = r.state === "live";
        return (
          <li key={r.month} className={panelClass({ padding: "sm" })}>
            <div className="flex items-baseline justify-between gap-2">
              <Link
                href={`/budget?month=${r.month}`}
                className="text-sm font-medium text-ink hover:underline"
              >
                {monthLabel(r.month)}
              </Link>
              <span className="text-xs text-ink-2">
                {r.state === "future" ? "not started" : live ? "in progress" : !r.hasPlan ? "no plan" : null}
              </span>
            </div>
            <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_3.5rem] items-baseline gap-x-3 gap-y-1 text-xs">
              <dt className="text-ink-2">Spend</dt>
              <dd className="text-right tabular-nums text-ink">
                {fmt(r.actual)}
                {r.plan > 0 && <span className="text-ink-2"> of {fmt(r.plan)}</span>}
              </dd>
              <dd className="text-right">
                <Dev value={live ? r.paceToDate : r.vsPlan} />
              </dd>
              {r.firstPlan !== null && r.firstPlan !== r.plan && (
                <>
                  <dt className="text-ink-2">vs first plan</dt>
                  <dd className="text-right tabular-nums text-ink-2">{fmt(r.firstPlan)}</dd>
                  <dd className="text-right">
                    <Dev value={r.vsFirst} />
                  </dd>
                </>
              )}
              {r.revenueTarget > 0 && (
                <>
                  <dt className="text-ink-2">Revenue</dt>
                  <dd className="text-right tabular-nums text-ink">
                    {sar0(r.revenue)}
                    <span className="text-ink-2"> of {sar0(r.revenueTarget)}</span>
                  </dd>
                  <dd className="text-right">
                    <Dev value={r.vsRevenue} />
                  </dd>
                </>
              )}
              {r.roas !== null && (
                <>
                  <dt className="text-ink-2">ROAS</dt>
                  <dd className="text-right tabular-nums text-ink">
                    {fmtRoas(r.roas)}
                    {r.roasTarget !== null && (
                      <span className="text-ink-2"> of {fmtRoas(r.roasTarget)}</span>
                    )}
                  </dd>
                  <dd />
                </>
              )}
              {r.reserve > 0 && (
                <>
                  <dt className="text-ink-2">Reserve used</dt>
                  <dd className="text-right tabular-nums text-ink">
                    {fmt(r.reserveUsed)}
                    <span className="text-ink-2"> of {fmt(r.reserve)}</span>
                  </dd>
                  <dd />
                </>
              )}
              {r.revisions > 0 && (
                <>
                  <dt className="text-ink-2">Plan saved</dt>
                  <dd className="text-right tabular-nums text-ink">
                    {r.revisions} {r.revisions === 1 ? "time" : "times"}
                  </dd>
                  <dd />
                </>
              )}
            </dl>
          </li>
        );
      })}
    </ul>
  );
}

// ── Table ────────────────────────────────────────────────────────────────────

function MonthsTable({
  rows,
  fmt,
  toDisplay,
  csvName,
}: {
  rows: MonthReviewRow[];
  fmt: (usd: number) => string;
  toDisplay: (usd: number) => number;
  csvName: string;
}) {
  const columns: DataColumn<MonthReviewRow>[] = useMemo(() => {
    const money = (usd: number | null) => (usd === null ? null : round2(toDisplay(usd)));
    const pctCsv = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 10);
    const dash = <span className="text-ink-3">—</span>;
    return [
      {
        key: "month",
        label: "Month",
        pinned: true,
        sortable: true,
        sortValue: (r) => r.month,
        csv: (r) => r.month,
        href: (r) => `/budget?month=${r.month}`,
        render: (r) => (
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            {shortMonth(r.month)}
            {r.state === "live" && <span className="text-xs text-ink-2">in progress</span>}
          </span>
        ),
      },
      {
        key: "actual",
        label: "Spend",
        align: "right",
        sortable: true,
        sortValue: (r) => r.actual,
        csv: (r) => money(r.actual),
        render: (r) => <span className="tabular-nums">{fmt(r.actual)}</span>,
      },
      {
        key: "plan",
        label: "Final plan",
        align: "right",
        sortable: true,
        sortValue: (r) => r.plan,
        csv: (r) => money(r.plan),
        render: (r) => (r.plan > 0 ? <span className="tabular-nums">{fmt(r.plan)}</span> : dash),
      },
      {
        key: "vsPlan",
        label: "vs final",
        align: "right",
        sortable: true,
        sortValue: (r) => r.vsPlan,
        csv: (r) => pctCsv(r.vsPlan),
        render: (r) => <Dev value={r.vsPlan} />,
      },
      {
        key: "firstPlan",
        label: "First plan",
        align: "right",
        sortable: true,
        sortValue: (r) => r.firstPlan,
        csv: (r) => money(r.firstPlan),
        render: (r) => (r.firstPlan === null ? dash : <span className="tabular-nums">{fmt(r.firstPlan)}</span>),
      },
      {
        key: "vsFirst",
        label: "vs first",
        align: "right",
        sortable: true,
        sortValue: (r) => r.vsFirst,
        csv: (r) => pctCsv(r.vsFirst),
        render: (r) => <Dev value={r.vsFirst} />,
      },
      {
        key: "revenue",
        label: "Revenue (SAR)",
        align: "right",
        sortable: true,
        sortValue: (r) => r.revenue,
        csv: (r) => round2(r.revenue),
        render: (r) => <span className="tabular-nums">{sar0(r.revenue)}</span>,
      },
      {
        key: "vsRevenue",
        label: "vs target",
        align: "right",
        sortable: true,
        sortValue: (r) => r.vsRevenue,
        csv: (r) => pctCsv(r.vsRevenue),
        render: (r) => <Dev value={r.vsRevenue} />,
      },
      {
        key: "roas",
        label: "ROAS",
        align: "right",
        sortable: true,
        sortValue: (r) => r.roas,
        csv: (r) => (r.roas === null ? null : Math.round(r.roas * 100) / 100),
        render: (r) => <span className="tabular-nums">{fmtRoas(r.roas)}</span>,
      },
      {
        key: "roasTarget",
        label: "Target ROAS",
        align: "right",
        sortable: true,
        sortValue: (r) => r.roasTarget,
        csv: (r) => (r.roasTarget === null ? null : Math.round(r.roasTarget * 100) / 100),
        render: (r) => <span className="tabular-nums">{fmtRoas(r.roasTarget)}</span>,
      },
      {
        key: "reserveUsed",
        label: "Reserve used",
        align: "right",
        sortable: true,
        sortValue: (r) => r.reserveUsed,
        csv: (r) => money(r.reserveUsed),
        render: (r) =>
          r.reserve > 0 ? (
            <span className="tabular-nums">
              {fmt(r.reserveUsed)} <span className="text-ink-2">of {fmt(r.reserve)}</span>
            </span>
          ) : (
            dash
          ),
      },
      {
        key: "revisions",
        label: "Plan saves",
        align: "right",
        sortable: true,
        sortValue: (r) => r.revisions,
        csv: (r) => r.revisions,
        render: (r) => <span className="tabular-nums">{r.revisions}</span>,
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, csvName]);
  const keys = columns.filter((c) => !c.pinned).map((c) => c.key);
  const cols = useTableColumns({ tableKey: TABLE_KEYS.BUDGET_REVIEW, hideable: keys, defaults: keys });
  return (
    <DataTable<MonthReviewRow>
      columns={columns}
      {...cols.tableProps}
      rows={rows}
      rowKey={(r) => r.month}
      sort="month"
      dir="desc"
      minWidthClass="min-w-[1100px]"
      csvFileName={csvName}
    />
  );
}

// ── Who changed what ─────────────────────────────────────────────────────────

function RevisionLog({ log, fmt }: { log: PlanRevisionLogRow[]; fmt: (usd: number) => string }) {
  return (
    <section className={panelClass({ padding: "none" })} aria-labelledby="plan-changes">
      <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <h2 id="plan-changes" className="text-sm font-medium text-ink">
          Plan changes
        </h2>
        <span className="text-xs tabular-nums text-ink-3">{log.length}</span>
        <InfoTip label="About this log">
          Every time a plan in these months was saved, uploaded, copied or restored — newest first.
          Open a month&rsquo;s Plan page to see a version in full or restore it.
        </InfoTip>
      </header>
      {log.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-2">No plan in these months has been saved yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {log.map((r) => {
            return (
              <li
                key={r.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 px-4 py-2.5 text-sm"
              >
                <span className="min-w-0">
                  <Link href={`/budget/plan?month=${r.month}`} className="font-medium text-ink hover:underline">
                    {shortMonth(r.month)}
                  </Link>
                  <span className="text-ink-2">
                    {" · "}
                    {r.savedBy}
                  </span>
                  {r.note && (
                    <span className="block truncate text-xs text-ink-2" dir="auto" title={r.note}>
                      {r.note}
                    </span>
                  )}
                </span>
                <span className="text-right">
                  <span className="block tabular-nums text-ink">
                    {r.readable ? fmt(r.plannedTotal + r.reserveSpendUsd) : "—"}
                  </span>
                  <span className="block text-xs tabular-nums text-ink-2">{dateTimeLabel(r.createdAt)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
