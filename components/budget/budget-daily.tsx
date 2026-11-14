"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipProps } from "recharts";
import { useRouter, usePathname } from "@/lib/brand-nav";
import { useNavTransition } from "@/lib/nav-progress";
import { ChartHeader, ChartShell, ExpandButton, plotClass } from "@/components/charts/chart-shell";
import { CHART_CURSOR, ChartTooltip } from "@/components/charts/chart-tooltip";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { InfoTip } from "@/components/ui/info-tip";
import { PlatformDot } from "@/components/ui/platform-dot";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { panelClass } from "@/components/ui/panel";
import { PlatformsPill } from "@/components/filters/platforms-pill";
import { ALL_PLATFORMS, PACING_COLOR, coversAllPlatforms } from "@/lib/palette";
import { int, longDate, monthDay, roas as fmtRoas, signedPct, usdCompact, sarCompact } from "@/lib/format";
import { queueFilterPrefs } from "@/lib/filter-prefs";
import { TABLE_KEYS } from "@/lib/table-columns";
import { cn } from "@/lib/utils";
import {
  isStrongTone,
  monthEndIso,
  monthLabel,
  monthStartIso,
  pacingTone,
  pacingVerdict,
  round2,
  spendInDisplayCurrency,
  type PacingTone,
  type PlatformCoverage,
} from "@/lib/budget";
import { buildRangeModel } from "@/lib/budget-range";
import { buildDayDetail, buildDayGrid, type DayCell, type DayDetail } from "@/lib/budget-daily";
import type { BudgetPacingSeries, MonthPlanRow } from "@/db/queries/budget";
import type { DailyView } from "@/validators/budget";
import {
  BudgetMonthBar,
  CurrencyToggle,
  PacingDevCell,
  formatSpend,
  platformLabel,
  toneText,
  useBudgetCurrency,
} from "@/components/budget/budget-shared";
import { useRememberedViews } from "@/components/budget/use-remembered-view";

const VIEW_DEFAULTS = { dayview: "calendar" };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A day cell's fill for its tone — the direction colour, strong or faint; never a new hex. */
function toneCell(tone: PacingTone): string {
  if (tone.direction === "muted") return "bg-surface-2";
  if (tone.direction === "ahead") return tone.strength === "strong" ? "bg-ahead/25" : "bg-ahead/10";
  return tone.strength === "strong" ? "bg-behind/25" : "bg-behind/10";
}

/** "+$110 (+55%)" in the direction colour, the word kept for a screen reader. */
function Delta({
  delta,
  deviation,
  fmt,
  className,
}: {
  delta: number | null;
  deviation: number | null;
  fmt: (usd: number) => string;
  className?: string;
}) {
  if (delta === null) return <span className={cn("text-ink-3", className)}>—</span>;
  const tone = pacingTone(deviation);
  return (
    <span className={cn("tabular-nums", toneText(tone, "text-ink-2"), className)}>
      {tone.direction !== "muted" && <span className="sr-only">{tone.direction} </span>}
      {delta > 0 ? "+" : delta < 0 ? "−" : ""}
      {fmt(Math.abs(delta))}
      {deviation !== null && Number.isFinite(deviation) && ` (${signedPct(deviation, 0)})`}
    </span>
  );
}

/**
 * Budget → Daily (2026-11-14, the restructure): DAY pacing. Pick any day of
 * the month and see what the plan gave it, what was spent on it, how far off
 * that was, and which platform did it. Three views of the same cells —
 * Calendar (the month at a glance), Bars (each day's miss around zero) and
 * Table (every figure, with a CSV) — remembered per user.
 *
 * A day is judged only on the platforms that have reported it; a day nobody
 * uploaded yet is "not reported", never zero. Read off `buildRangeModel`.
 */
export function BudgetDaily({
  month,
  today,
  series,
  plans,
  rate,
  coverage,
  storeHorizon,
  initialDay,
  initialPlatforms,
  view,
}: {
  month: string;
  today: string;
  series: BudgetPacingSeries;
  plans: MonthPlanRow[];
  rate: number;
  coverage: PlatformCoverage;
  storeHorizon: string | null;
  /** `?day=` when it names a day of this month. */
  initialDay: string | null;
  /** The remembered platform filter (empty = every platform). */
  initialPlatforms: string[];
  view: DailyView;
}) {
  const [currency, pickCurrency] = useBudgetCurrency();
  const fmt = (usd: number) => formatSpend(usd, currency, rate, { whole: true });
  const fmtCents = (usd: number) => formatSpend(usd, currency, rate);
  const toDisplay = (usd: number) => spendInDisplayCurrency(usd, currency, rate);
  const compact = (usd: number) =>
    currency === "SAR" ? sarCompact(toDisplay(usd)) : usdCompact(usd);
  const from = monthStartIso(month);
  const to = monthEndIso(month);

  const [views, setView] = useRememberedViews({ dayview: view }, VIEW_DEFAULTS, ["platforms"]);
  const [platforms, setPlatforms] = useState(initialPlatforms);
  const togglePlatform = (platform: string) => {
    const next = platforms.includes(platform)
      ? platforms.filter((p) => p !== platform)
      : [...platforms, platform];
    const value = coversAllPlatforms(next) ? [] : next;
    setPlatforms(value);
    queueFilterPrefs([{ key: "platforms", values: value }]);
  };

  // The month stepper keeps the page's own state out of the URL but the
  // month in it, so a day link is shareable.
  const router = useRouter();
  const pathname = usePathname();
  const [, startNav] = useNavTransition();
  const goMonth = (m: string) =>
    startNav(() => router.replace(`${pathname}?month=${m}`, { scroll: false }));

  const model = useMemo(
    () => buildRangeModel({ from, to, series, plans, rate, platforms, coverage, storeHorizon, today }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [from, to, series, plans, rate, platforms.join(","), coverage, storeHorizon, today],
  );
  const grid = useMemo(() => buildDayGrid(model, today), [model, today]);

  // The day in view: the URL's, else the last day anything was reported.
  const lastReported = [...grid].reverse().find((c) => c.actual !== null)?.date ?? null;
  const [picked, setPicked] = useState<string | null>(initialDay);
  const day = picked && picked >= from && picked <= to ? picked : (lastReported ?? from);
  const detail = useMemo(() => buildDayDetail(model, day, today), [model, day, today]);

  const judged = grid.filter((c) => c.state === "judged");
  const strong = (c: DayCell) => isStrongTone(pacingTone(c.deviation));
  const over = judged.filter((c) => strong(c) && (c.deviation ?? 0) > 0).length;
  const under = judged.filter((c) => strong(c) && (c.deviation ?? 0) < 0).length;
  const planMode = model.monthPlan?.planMode ?? "curve";
  const hasPlan = (model.monthPlan?.allocations.length ?? 0) > 0;

  const dayWords = (c: DayCell): string => {
    const head = longDate(c.date);
    if (c.state === "future") return `${head}: ${fmt(c.plan)} planned`;
    if (c.state === "not_reported") return `${head}: not reported yet`;
    if (c.state === "no_plan") return `${head}: ${fmt(c.actual ?? 0)} spent, nothing planned`;
    return `${head}: ${fmt(c.actual ?? 0)} spent of ${fmt(c.plan)} planned, ${pacingVerdict(c.deviation)}`;
  };

  return (
    <div className="space-y-4">
      <BudgetMonthBar month={month} today={today} onMonthChange={goMonth}>
        <PlatformsPill options={ALL_PLATFORMS} selected={platforms} onToggle={togglePlatform} />
        <SegmentedControl<DailyView>
          ariaLabel="View"
          value={views.dayview as DailyView}
          onChange={(v) => setView("dayview", v)}
          options={[
            { value: "calendar", label: "Calendar" },
            { value: "bars", label: "Bars" },
            { value: "table", label: "Table" },
          ]}
        />
        <CurrencyToggle currency={currency} onChange={pickCurrency} />
      </BudgetMonthBar>

      <p className="text-xs text-ink-2">
        {judged.length === 0 ? (
          hasPlan ? (
            <>No day of {monthLabel(month)} has been reported yet.</>
          ) : (
            <>No plan for {monthLabel(month)} — days show what was spent.</>
          )
        ) : (
          <>
            <span className="tabular-nums">{judged.length}</span> days reported
            {" · "}
            <span className={cn("tabular-nums", over > 0 && "text-ahead")}>{over}</span> over
            {" · "}
            <span className={cn("tabular-nums", under > 0 && "text-behind")}>{under}</span> under
          </>
        )}
        <InfoTip label="How a day is judged" className="ml-1.5 align-middle">
          {planMode === "daily"
            ? "Each day is compared with the amount the plan sheet gave it."
            : "Each day is compared with its share of the month under the plan's day curve."}{" "}
          A day counts only the platforms that have uploaded it; over or under means more than 15%
          off.
        </InfoTip>
      </p>

      <div className="grid gap-4 @4xl/main:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @4xl/main:items-start">
        <div className="min-w-0">
          {views.dayview === "calendar" && (
            <Calendar grid={grid} day={day} onPick={setPicked} words={dayWords} compact={compact} />
          )}
          {views.dayview === "bars" && (
            <DeviationBars
              grid={grid}
              day={day}
              onPick={setPicked}
              title={monthLabel(month)}
              toDisplay={toDisplay}
              fmt={fmt}
              compact={compact}
            />
          )}
          {views.dayview === "table" && (
            <DayTable
              grid={grid}
              day={day}
              onPick={setPicked}
              fmt={fmt}
              fmtCents={fmtCents}
              toDisplay={toDisplay}
              csvName={`budget-daily-${month}-${currency.toLowerCase()}`}
            />
          )}
        </div>
        <DayPanel detail={detail} fmt={fmt} fmtCents={fmtCents} monthName={monthLabel(month)} />
      </div>
    </div>
  );
}

// ── Calendar ─────────────────────────────────────────────────────────────────

function Calendar({
  grid,
  day,
  onPick,
  words,
  compact,
}: {
  grid: DayCell[];
  day: string;
  onPick: (date: string) => void;
  words: (c: DayCell) => string;
  compact: (usd: number) => string;
}) {
  const first = grid[0];
  if (!first) return null;
  const offset = new Date(`${first.date}T00:00:00Z`).getUTCDay();
  return (
    <section className={panelClass({ padding: "sm" })} aria-label="Days of the month">
      <div className="grid grid-cols-7 gap-1 text-center text-label text-ink-3" aria-hidden="true">
        {WEEKDAYS.map((w) => (
          <span key={w} className="py-1">
            <span className="sm:hidden">{w.slice(0, 1)}</span>
            <span className="hidden sm:inline">{w}</span>
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: offset }, (_, i) => (
          <span key={`pad-${i}`} />
        ))}
        {grid.map((c) => {
          const tone = pacingTone(c.deviation);
          const selected = c.date === day;
          return (
            <button
              key={c.date}
              type="button"
              onClick={() => onPick(c.date)}
              aria-pressed={selected}
              aria-label={words(c)}
              className={cn(
                "flex min-h-14 flex-col items-start justify-between rounded-md px-1.5 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand sm:min-h-16 sm:px-2",
                c.state === "judged" && toneCell(tone),
                c.state === "no_plan" && "bg-surface-2",
                c.state === "not_reported" && "border border-dashed border-line-strong",
                c.state === "future" && "border border-line",
                selected && "ring-2 ring-ink",
              )}
            >
              <span className="text-xs tabular-nums text-ink-2">{Number(c.date.slice(8))}</span>
              <span className="w-full truncate text-xs tabular-nums">
                {c.state === "judged" ? (
                  <span className={toneText(tone, "text-ink-2")}>{signedPct(c.deviation, 0)}</span>
                ) : c.state === "no_plan" ? (
                  <span className="text-ink">{compact(c.actual ?? 0)}</span>
                ) : c.state === "future" ? (
                  <span className="text-ink-3">{c.plan > 0 ? compact(c.plan) : ""}</span>
                ) : (
                  <span className="text-ink-3">—</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
        <Key className="bg-ahead/25" label="over plan" />
        <Key className="bg-behind/25" label="under plan" />
        <Key className="border border-dashed border-line-strong" label="not reported yet" />
        <Key className="border border-line" label="planned" />
      </p>
    </section>
  );
}

function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-3 w-3 rounded-sm", className)} aria-hidden="true" />
      {label}
    </span>
  );
}

// ── Bars ─────────────────────────────────────────────────────────────────────

interface BarPoint {
  date: string;
  label: string;
  delta: number | null;
  code: 1 | -1 | 0;
  cell: DayCell;
}

function DeviationBars({
  grid,
  day,
  onPick,
  title,
  toDisplay,
  fmt,
  compact,
}: {
  grid: DayCell[];
  day: string;
  onPick: (date: string) => void;
  title: string;
  toDisplay: (usd: number) => number;
  fmt: (usd: number) => string;
  compact: (usd: number) => string;
}) {
  const data: BarPoint[] = grid.map((c) => {
    const tone = pacingTone(c.deviation);
    return {
      date: c.date,
      label: String(Number(c.date.slice(8))),
      delta: c.delta === null ? null : round2(toDisplay(c.delta)),
      code: isStrongTone(tone) ? (tone.direction === "ahead" ? 1 : -1) : 0,
      cell: c,
    };
  });
  const tip = ({ active, payload }: TooltipProps<number, string>) => {
    const p = payload?.[0]?.payload as BarPoint | undefined;
    if (!active || !p) return null;
    const c = p.cell;
    return (
      <ChartTooltip>
        <div className="mb-1 font-medium text-ink">{monthDay(c.date)}</div>
        {c.state === "judged" ? (
          <>
            <p className="tabular-nums">
              {fmt(c.actual ?? 0)} of {fmt(c.plan)}
            </p>
            <Delta delta={c.delta} deviation={c.deviation} fmt={fmt} />
          </>
        ) : (
          <p className="text-ink-3">{c.state === "not_reported" ? "not reported yet" : "no verdict"}</p>
        )}
      </ChartTooltip>
    );
  };
  return (
    <ChartShell summary={`Each day's spend against that day's plan, ${title}: bars above zero are over plan, below zero under.`}>
      {({ inFull, toggleExpand }) => (
        <>
          <ChartHeader
            title="Spent against plan, by day"
            controls={<ExpandButton inFull={inFull} onClick={toggleExpand} />}
          />
          <div className={plotClass(inFull, "md")}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                accessibilityLayer
                data={data}
                margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                onClick={(s) => {
                  const date = (s?.activePayload?.[0]?.payload as BarPoint | undefined)?.date;
                  if (date) onPick(date);
                }}
              >
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                  stroke="var(--line-2)"
                  tickMargin={6}
                  interval="preserveStartEnd"
                  minTickGap={12}
                />
                <YAxis
                  width={56}
                  tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                  stroke="var(--line-2)"
                  tickFormatter={(v: number) => compact(spendBack(v, toDisplay))}
                />
                <ReferenceLine y={0} stroke="var(--ink-3)" strokeWidth={1} />
                <Tooltip cursor={CHART_CURSOR} content={tip} />
                <Bar dataKey="delta" isAnimationActive={false} radius={2} className="cursor-pointer">
                  {data.map((p) => (
                    <Cell
                      key={p.date}
                      fill={p.code === 1 ? PACING_COLOR.ahead : p.code === -1 ? PACING_COLOR.behind : "var(--ink-3)"}
                      fillOpacity={p.date === day ? 1 : 0.7}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </ChartShell>
  );
}

/** The axis ticks arrive in the display currency; the compact formatter takes USD. */
function spendBack(displayValue: number, toDisplay: (usd: number) => number): number {
  const perUsd = toDisplay(1);
  return perUsd > 0 ? displayValue / perUsd : displayValue;
}

// ── Table ────────────────────────────────────────────────────────────────────

function DayTable({
  grid,
  day,
  onPick,
  fmt,
  fmtCents,
  toDisplay,
  csvName,
}: {
  grid: DayCell[];
  day: string;
  onPick: (date: string) => void;
  fmt: (usd: number) => string;
  fmtCents: (usd: number) => string;
  toDisplay: (usd: number) => number;
  csvName: string;
}) {
  const columns: DataColumn<DayCell>[] = useMemo(() => {
    const money = (usd: number | null) => (usd === null ? null : round2(toDisplay(usd)));
    const dash = <span className="text-ink-3">—</span>;
    const reported = grid.filter((c) => c.actual !== null);
    const judged = grid.filter((c) => c.state === "judged");
    const sum = (rows: DayCell[], pick: (c: DayCell) => number) => rows.reduce((s, c) => s + pick(c), 0);
    return [
      {
        key: "date",
        label: "Day",
        pinned: true,
        sortable: true,
        defaultSortDir: "asc",
        sortValue: (c) => c.date,
        csv: (c) => c.date,
        render: (c) => <span className="tabular-nums">{c.date}</span>,
        total: () => <span className="text-ink-3">Total</span>,
      },
      {
        key: "plan",
        label: "Planned",
        align: "right",
        sortable: true,
        sortValue: (c) => c.plan,
        csv: (c) => money(c.plan),
        render: (c) => <span className="tabular-nums">{fmt(c.plan)}</span>,
        total: () => <span className="tabular-nums">{fmt(sum(grid, (c) => c.plan))}</span>,
      },
      {
        key: "actual",
        label: "Spent",
        align: "right",
        sortable: true,
        sortValue: (c) => c.actual,
        csv: (c) => money(c.actual),
        render: (c) =>
          c.actual === null ? (
            <span className="text-xs text-ink-3">
              {c.state === "future" ? "" : "not reported"}
            </span>
          ) : (
            <span className="tabular-nums">{fmt(c.actual)}</span>
          ),
        total: () => <span className="tabular-nums">{fmt(sum(reported, (c) => c.actual ?? 0))}</span>,
      },
      {
        key: "delta",
        label: "Δ",
        align: "right",
        sortable: true,
        sortValue: (c) => c.delta,
        csv: (c) => money(c.delta),
        render: (c) => <Delta delta={c.delta} deviation={null} fmt={fmt} className="text-xs" />,
        total: () => (
          <span className="tabular-nums">
            {judged.length === 0 ? "—" : fmt(sum(judged, (c) => c.delta ?? 0))}
          </span>
        ),
      },
      {
        key: "deviation",
        label: "Δ%",
        align: "right",
        sortable: true,
        sortValue: (c) => c.deviation,
        csv: (c) => (c.deviation === null ? null : Math.round(c.deviation * 1000) / 10),
        render: (c) => <PacingDevCell deviation={c.deviation} />,
      },
      {
        key: "purchases",
        label: "Purchases (platform)",
        align: "right",
        sortable: true,
        sortValue: (c) => c.results.purchases,
        csv: (c) => c.results.purchases,
        render: (c) => <span className="tabular-nums">{int(c.results.purchases)}</span>,
      },
      {
        key: "roas",
        label: "ROAS (platform)",
        align: "right",
        sortable: true,
        sortValue: (c) => c.results.roas,
        csv: (c) => (c.results.roas === null ? null : Math.round(c.results.roas * 100) / 100),
        render: (c) => <span className="tabular-nums">{fmtRoas(c.results.roas)}</span>,
      },
      {
        key: "cpa",
        label: "CPA (platform)",
        align: "right",
        sortable: true,
        sortValue: (c) => c.results.cpa,
        csv: (c) => money(c.results.cpa),
        render: (c) =>
          c.results.cpa === null ? dash : <span className="tabular-nums">{fmtCents(c.results.cpa)}</span>,
      },
      {
        key: "reporting",
        label: "Platforms reported",
        align: "right",
        csv: (c) => `${c.reporting}/${c.platforms}`,
        render: (c) => (
          <span className="tabular-nums text-ink-2">
            {c.reporting}/{c.platforms}
          </span>
        ),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, csvName]);
  const keys = columns.filter((c) => !c.pinned).map((c) => c.key);
  const cols = useTableColumns({
    tableKey: TABLE_KEYS.BUDGET_DAILY,
    hideable: keys,
    defaults: keys,
    defaultHidden: ["reporting"],
  });
  return (
    <DataTable<DayCell>
      columns={columns}
      {...cols.tableProps}
      rows={grid}
      rowKey={(c) => c.date}
      sort="date"
      dir="asc"
      showTotals
      onRowClick={(c) => onPick(c.date)}
      rowClassName={(c) => cn("cursor-pointer", c.date === day && "bg-surface-2/60")}
      minWidthClass="min-w-[760px]"
      csvFileName={csvName}
    />
  );
}

// ── The day ──────────────────────────────────────────────────────────────────

function DayPanel({
  detail,
  fmt,
  fmtCents,
  monthName,
}: {
  detail: DayDetail;
  fmt: (usd: number) => string;
  fmtCents: (usd: number) => string;
  monthName: string;
}) {
  const { cell, platforms, toDate } = detail;
  return (
    <section className={panelClass({ padding: "none" })} aria-live="polite" aria-label={`Day detail, ${longDate(cell.date)}`}>
      <header className="border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-medium text-ink">{longDate(cell.date)}</h2>
        <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-sm">
          {cell.state === "future" ? (
            <span className="text-ink-2">
              <span className="tabular-nums text-ink">{fmt(cell.plan)}</span> planned
            </span>
          ) : cell.state === "not_reported" ? (
            <span className="text-ink-2">Not reported yet</span>
          ) : (
            <>
              <span className="text-base font-medium tabular-nums text-ink">{fmt(cell.actual ?? 0)}</span>
              {cell.state === "judged" ? (
                <>
                  <span className="tabular-nums text-ink-2">of {fmt(cell.plan)}</span>
                  <Delta delta={cell.delta} deviation={cell.deviation} fmt={fmt} />
                </>
              ) : (
                <span className="text-ink-2">nothing planned</span>
              )}
            </>
          )}
        </p>
        {cell.reporting > 0 && cell.reporting < cell.platforms && (
          <p className="mt-0.5 text-xs text-ink-2">
            <span className="tabular-nums">{cell.reporting}</span> of{" "}
            <span className="tabular-nums">{cell.platforms}</span> platforms have reported this day
          </p>
        )}
      </header>

      {platforms.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-2">Nothing planned or spent on this day.</p>
      ) : (
        <ul className="divide-y divide-line">
          {platforms.map((p) => (
            <li key={p.platform} className="px-4 py-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
                <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                  <PlatformDot platform={p.platform} />
                  {platformLabel(p.platform)}
                </span>
                {p.reported ? (
                  <span className="flex flex-wrap items-baseline justify-end gap-x-2">
                    <span className="tabular-nums text-ink">{fmt(p.actual)}</span>
                    {p.plan > 0 && <span className="tabular-nums text-ink-2">of {fmt(p.plan)}</span>}
                    {p.plan > 0 ? (
                      <Delta delta={p.delta} deviation={p.deviation} fmt={fmt} className="text-xs" />
                    ) : (
                      <span className="text-xs text-ink-2">no plan</span>
                    )}
                  </span>
                ) : (
                  <span className="text-xs text-ink-2">
                    not uploaded yet
                    {p.plan > 0 && (
                      <>
                        {" · "}
                        <span className="tabular-nums">{fmt(p.plan)}</span> planned
                      </>
                    )}
                  </span>
                )}
              </div>
              {p.reported && p.buckets.length > 1 && (
                <ul className="mt-1 space-y-0.5 pl-5">
                  {p.buckets.map((b) => (
                    <li key={b.objective} className="flex items-baseline justify-between gap-3 text-xs text-ink-2">
                      <span>{b.objective}</span>
                      <span className="tabular-nums">
                        {fmt(b.actual)}
                        {b.plan > 0 && <> of {fmt(b.plan)}</>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {p.reported && p.results.purchases !== null && (
                <p
                  className="mt-1 pl-5 text-xs tabular-nums text-ink-2"
                  aria-label={`${platformLabel(p.platform)}, platform-reported: ${int(p.results.purchases)} purchases, ROAS ${fmtRoas(p.results.roas)}${p.results.cpa === null ? "" : `, ${fmtCents(p.results.cpa)} per purchase`}`}
                >
                  {int(p.results.purchases)} purchases · {fmtRoas(p.results.roas)}
                  {p.results.cpa !== null && <> · {fmtCents(p.results.cpa)}</>}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {toDate.expected > 0 && cell.state !== "future" && cell.state !== "not_reported" && (
        <footer className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-line px-4 py-2.5 text-xs text-ink-2">
          <span>
            {monthName.split(" ")[0]} through {monthDay(cell.date)}
          </span>
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="tabular-nums text-ink">{fmt(toDate.actual)}</span>
            <span className="tabular-nums">of {fmt(toDate.expected)}</span>
            <Delta delta={toDate.delta} deviation={toDate.deviation} fmt={fmt} />
          </span>
        </footer>
      )}
    </section>
  );
}
