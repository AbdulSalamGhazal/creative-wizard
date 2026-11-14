"use client";

import { useMemo, useState } from "react";
import Link from "@/components/nav/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoTip } from "@/components/ui/info-tip";
import { PlatformDot } from "@/components/ui/platform-dot";
import { panelClass } from "@/components/ui/panel";
import { monthDay, sar, signedPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  filterTrackerPlatforms,
  isoDaysBetween,
  monthEndIso,
  monthLabel,
  monthStartIso,
  pacingDeviation,
  pacingTone,
  sortTrackerPlatforms,
  spendInDisplayCurrency,
  trackerCounts,
  type PlatformCoverage,
} from "@/lib/budget";
import { buildRangeModel, type RangeModel } from "@/lib/budget-range";
import { buildAttention, type AttentionItem } from "@/lib/budget-attention";
import type { BudgetPacingSeries, MonthPlanRow } from "@/db/queries/budget";
import type { PacingBoard as BoardMode, PacingGroup, PacingRank } from "@/validators/budget";
import {
  BudgetMonthBar,
  CurrencyToggle,
  formatSpend,
  platformLabel,
  toneText,
  useBudgetCurrency,
} from "@/components/budget/budget-shared";
import { RangeCard } from "@/components/budget/range-card";
import { PacingBoard } from "@/components/budget/pacing-board";
import { useRememberedViews } from "@/components/budget/use-remembered-view";

const VIEW_DEFAULTS = { board: "bars", rank: "plan", group: "platform" };

/**
 * Budget → Today (2026-11-14, the restructure): the page the person spending
 * the money opens every morning. Four questions, top to bottom — where the
 * month stands (three cards), what wants a decision (Needs attention), what
 * each platform did on its last reported day, and every line's pace (the ONE
 * board, the same component and builder Analysis draws for any range).
 *
 * Nothing here is a second math path: every number is `buildRangeModel` over
 * the month, and the attention list is derived from the board's own rows.
 * Actuals are RAW (no exclusion filtering — the module's standing decision).
 */
export function BudgetToday({
  month,
  today,
  series,
  plans,
  rate,
  coverage,
  storeHorizon,
  seedMonth,
  canManage,
  view,
  moveMoney,
}: {
  month: string; // YYYY-MM
  today: string;
  /** The Pacing scan over the month. */
  series: BudgetPacingSeries;
  /** The month's plan row (an empty row when nothing is planned). */
  plans: MonthPlanRow[];
  rate: number;
  /** Latest uploaded day per platform — every comparison anchors to it. */
  coverage: PlatformCoverage;
  storeHorizon: string | null;
  /** The most recent planned month before this one — the rollover nudge. */
  seedMonth: string | null;
  canManage: boolean;
  /** The board's remembered controls (URL-less: saved per user per brand). */
  view: { board: BoardMode; rank: PacingRank; group: PacingGroup };
  /** The Move money control — the page passes it so this file stays read-only. */
  moveMoney?: (model: RangeModel) => React.ReactNode;
}) {
  const [currency, pickCurrency] = useBudgetCurrency();
  const fmtSpend = (usd: number) => formatSpend(usd, currency, rate);
  const fmtWhole = (usd: number) => formatSpend(usd, currency, rate, { whole: true });
  const from = monthStartIso(month);
  const to = monthEndIso(month);

  const model = useMemo(
    () =>
      buildRangeModel({ from, to, series, plans, rate, platforms: [], coverage, storeHorizon, today }),
    [from, to, series, plans, rate, coverage, storeHorizon, today],
  );
  const attention = useMemo(() => buildAttention(model, coverage), [model, coverage]);

  const [views, setView] = useRememberedViews(view, VIEW_DEFAULTS);
  const [offPace, setOffPace] = useState(false);
  const rows = useMemo(
    () =>
      sortTrackerPlatforms(
        filterTrackerPlatforms(model.board.platforms, { buckets: [], offPaceOnly: offPace }),
        views.rank as PacingRank,
      ),
    [model.board.platforms, offPace, views.rank],
  );

  const plan = model.monthPlan;
  const hasPlan = !!plan && (plan.allocations.length > 0 || plan.reserveSpendUsd > 0);
  const title = monthLabel(month);
  const planHref = `/budget/plan?month=${month}`;

  const bar = (
    <BudgetMonthBar month={month} today={today}>
      <CurrencyToggle currency={currency} onChange={pickCurrency} />
      {hasPlan && moveMoney?.(model)}
      {canManage && hasPlan && (
        <Link
          href={planHref}
          className="inline-flex items-center gap-1 text-xs text-ink-2 transition-colors hover:text-ink"
        >
          Edit plan
          <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </BudgetMonthBar>
  );

  if (!hasPlan) {
    return (
      <div className="space-y-4">
        {bar}
        <EmptyMonth
          month={month}
          seedMonth={seedMonth}
          canManage={canManage}
          spent={model.card.spend.bar.actual}
          revenue={model.card.revenue.bar.actual}
          fmt={fmtSpend}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        {bar}
        <CoverageWords model={model} storeHorizon={storeHorizon} title={title} />
      </div>

      <div className="grid grid-cols-1 gap-3 @2xl/main:grid-cols-3">
        <RangeCard metric="spend" title={title} card={model.card} fmtSpend={fmtSpend} rate={rate} />
        <RangeCard metric="revenue" title={title} card={model.card} fmtSpend={fmtSpend} rate={rate} />
        <RangeCard metric="roas" title={title} card={model.card} fmtSpend={fmtSpend} rate={rate} />
      </div>

      <AttentionList items={attention} month={month} fmt={fmtWhole} canManage={canManage} />

      <LastDay model={model} month={month} fmt={fmtWhole} />

      <PacingBoard
        from={from}
        to={to}
        title={title}
        rows={rows}
        totalRows={model.board.platforms.length}
        counts={trackerCounts(model.board.platforms)}
        board={views.board as BoardMode}
        rank={views.rank as PacingRank}
        group={views.group as PacingGroup}
        offPace={offPace}
        onBoard={(v) => setView("board", v)}
        onRank={(v) => setView("rank", v)}
        onGroup={(v) => setView("group", v)}
        onBehind={() => setOffPace((v) => !v)}
        reserve={model.reserve}
        fmt={fmtWhole}
        fmtCents={fmtSpend}
        toDisplay={(usd) => spendInDisplayCurrency(usd, currency, rate)}
        currency={currency}
        planMonth={month}
        canManage={canManage}
      />
    </div>
  );
}

/** "Day 13 of 30 · data through Nov 13 · store through Nov 12". */
function CoverageWords({
  model,
  storeHorizon,
  title,
}: {
  model: RangeModel;
  storeHorizon: string | null;
  title: string;
}) {
  const { state, through, lastData } = model.card.spend;
  if (state === "future") {
    return <p className="text-xs text-ink-2">Not started — {title} is ahead of us</p>;
  }
  const total = isoDaysBetween(model.from, model.to).length;
  const day = through ? isoDaysBetween(model.from, through).length : 0;
  const storeDay = storeHorizon && storeHorizon < model.to ? storeHorizon : null;
  return (
    <p className="text-xs text-ink-2">
      {state === "final" ? (
        <>Final</>
      ) : (
        <>
          Day <span className="tabular-nums">{day}</span> of{" "}
          <span className="tabular-nums">{total}</span>
        </>
      )}
      {lastData && (
        <span className="text-ink-3">
          {" · data through "}
          <span className="tabular-nums">{monthDay(lastData)}</span>
        </span>
      )}
      {storeDay && storeDay !== lastData && storeDay >= model.from && (
        <span className="text-ink-3">
          {" · store through "}
          <span className="tabular-nums">{monthDay(storeDay)}</span>
        </span>
      )}
    </p>
  );
}

// ── Needs attention ──────────────────────────────────────────────────────────

function AttentionList({
  items,
  month,
  fmt,
  canManage,
}: {
  items: AttentionItem[];
  month: string;
  fmt: (usd: number) => string;
  canManage: boolean;
}) {
  if (items.length === 0) return null;
  const planHref = `/budget/plan?month=${month}`;
  return (
    <section className={panelClass({ padding: "none" })} aria-labelledby="needs-attention">
      <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <h2 id="needs-attention" className="text-sm font-medium text-ink">
          Needs attention
        </h2>
        <span className="text-xs tabular-nums text-ink-3">{items.length}</span>
        <InfoTip label="About this list">
          Platforms more than 15% off their pace, a projected overshoot the reserve can&rsquo;t
          cover, spend with no plan, and platforms whose uploads trail the rest. Each platform is
          judged through its own last uploaded day.
        </InfoTip>
      </header>
      <ul className="divide-y divide-line">
        {items.map((item) => {
          const row = attentionRow(item, month, fmt, planHref, canManage);
          return (
            <li
              key={row.key}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm"
            >
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                {row.lead}
                <span className="text-ink-2">{row.detail}</span>
              </span>
              {row.href && (
                <Link
                  href={row.href}
                  className="inline-flex shrink-0 items-center gap-1 text-xs text-ink-2 transition-colors hover:text-ink"
                >
                  {row.action}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PlatformName({ platform }: { platform: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-medium text-ink">
      <PlatformDot platform={platform} />
      {platformLabel(platform)}
    </span>
  );
}

function attentionRow(
  item: AttentionItem,
  month: string,
  fmt: (usd: number) => string,
  planHref: string,
  canManage: boolean,
): { key: string; lead: React.ReactNode; detail: React.ReactNode; href?: string; action?: string } {
  const perDay = (usd: number) => `${fmt(usd)}/day`;
  switch (item.kind) {
    case "reserve":
      return {
        key: "reserve",
        lead: <span className="font-medium text-ink">Reserve</span>,
        detail: (
          <>
            this pace draws <span className="tabular-nums text-ink">{fmt(item.projectedUse)}</span>
            {item.reserve > 0 ? (
              <>
                {" of "}
                <span className="tabular-nums">{fmt(item.reserve)}</span>
              </>
            ) : (
              " with no reserve set"
            )}
            {" · "}
            <span className={cn("tabular-nums", toneText({ direction: "ahead", strength: "strong" }))}>
              {fmt(item.exceededBy)} over at month end
            </span>
          </>
        ),
        href: canManage ? planHref : undefined,
        action: "Plan",
      };
    case "pace": {
      const tone = toneText(pacingTone(item.deviation));
      return {
        key: `pace-${item.platform}`,
        lead: <PlatformName platform={item.platform} />,
        detail: (
          <>
            <span className={cn("tabular-nums", tone)}>
              {item.delta > 0 ? "+" : "−"}
              {fmt(Math.abs(item.delta))} ({signedPct(item.deviation, 0)})
            </span>
            {" · "}
            {item.direction === "behind" && item.neededPerDay !== null ? (
              <>
                needs <span className="tabular-nums text-ink">{perDay(item.neededPerDay)}</span>,
                running <span className="tabular-nums">{perDay(item.runRate)}</span>
              </>
            ) : (
              <>
                running <span className="tabular-nums text-ink">{perDay(item.runRate)}</span>
                {item.projection !== null && (
                  <>
                    {" · lands "}
                    <span className="tabular-nums">{fmt(item.projection)}</span>
                    {" of "}
                    <span className="tabular-nums">{fmt(item.plan)}</span>
                  </>
                )}
              </>
            )}
          </>
        ),
        href: `/budget/days?month=${month}&platforms=${item.platform}`,
        action: "Days",
      };
    }
    case "unplanned":
      return {
        key: `unplanned-${item.platform}`,
        lead: <PlatformName platform={item.platform} />,
        detail: (
          <>
            <span className="tabular-nums text-ink">{fmt(item.amount)}</span> spent with no plan
          </>
        ),
        href: canManage ? planHref : undefined,
        action: "Plan",
      };
    case "stale":
      return {
        key: `stale-${item.platform}`,
        lead: <PlatformName platform={item.platform} />,
        detail: item.date ? (
          <>
            data ends <span className="tabular-nums text-ink">{monthDay(item.date)}</span>
            {item.daysBehind !== null && (
              <>
                {" · "}
                <span className="tabular-nums">{item.daysBehind}</span> days behind
              </>
            )}
          </>
        ) : (
          <>no data uploaded yet</>
        ),
        href: "/uploads",
        action: "Upload",
      };
  }
}

// ── The last reported day ────────────────────────────────────────────────────

/**
 * What each platform spent on ITS last reported day against that day's plan.
 * Never "yesterday": uploads arrive on different days, so each tile names its
 * own date. The day's plan is the plan series' own value for that day.
 */
function LastDay({
  model,
  month,
  fmt,
}: {
  model: RangeModel;
  month: string;
  fmt: (usd: number) => string;
}) {
  const days = model.board.days;
  const tiles = model.board.platforms
    .filter((p) => p.plan > 0 || p.actual > 0)
    .map((p) => {
      const idx = p.lastData ? days.indexOf(p.lastData) : -1;
      return {
        key: p.key,
        date: idx >= 0 ? p.lastData : null,
        actual: idx >= 0 ? (p.daily.actual[idx] ?? 0) : 0,
        plan: idx >= 0 ? (p.daily.plan[idx] ?? 0) : 0,
      };
    });
  if (tiles.length === 0 || model.card.spend.state === "future") return null;
  return (
    <section aria-labelledby="last-day">
      <h2 id="last-day" className="mb-2 text-sm font-medium text-ink">
        Last reported day
      </h2>
      <div className="grid grid-cols-2 gap-2 @2xl/main:grid-cols-3 @4xl/main:grid-cols-5">
        {tiles.map((t) => {
          const tone = t.plan > 0 ? pacingTone(pacingDeviation(t.actual, t.plan)) : null;
          const name = platformLabel(t.key);
          return (
            <Link
              key={t.key}
              href={
                t.date
                  ? `/budget/days?month=${month}&day=${t.date}`
                  : `/budget/days?month=${month}`
              }
              aria-label={
                t.date
                  ? `${name}, ${monthDay(t.date)}: ${fmt(t.actual)} spent${
                      t.plan > 0 ? ` of ${fmt(t.plan)} planned` : ", no plan that day"
                    }`
                  : `${name}: no data this month`
              }
              className={cn(panelClass({ padding: "sm" }), "block transition-colors hover:border-line-strong")}
            >
              <span className="flex items-center justify-between gap-2 text-xs text-ink-2">
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <PlatformDot platform={t.key} />
                  <span className="truncate">{name}</span>
                </span>
                {t.date && <span className="shrink-0 tabular-nums text-ink-3">{monthDay(t.date)}</span>}
              </span>
              {t.date ? (
                <span className="mt-1 flex items-baseline gap-1.5">
                  <span className={cn("text-base font-medium tabular-nums", tone ? toneText(tone, "text-ink") : "text-ink")}>
                    {fmt(t.actual)}
                  </span>
                  {t.plan > 0 && (
                    <span className="text-xs tabular-nums text-ink-3">of {fmt(t.plan)}</span>
                  )}
                </span>
              ) : (
                <span className="mt-1 block text-xs text-ink-3">no data yet</span>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

// ── No plan ──────────────────────────────────────────────────────────────────

function EmptyMonth({
  month,
  seedMonth,
  canManage,
  spent,
  revenue,
  fmt,
}: {
  month: string;
  seedMonth: string | null;
  canManage: boolean;
  /** Raw month-to-date spend (USD) and store revenue (SAR) — a month with
   *  uploads but no plan still says what happened. */
  spent: number;
  revenue: number;
  fmt: (v: number) => string;
}) {
  const planHref = `/budget/plan?month=${month}`;
  return (
    <EmptyState
      title="No plan for this month yet."
      hint={
        <>
          {(spent > 0 || revenue > 0) && (
            <p>
              {spent > 0 && (
                <>
                  <span className="tabular-nums text-ink-2">{fmt(spent)}</span> spent
                </>
              )}
              {spent > 0 && revenue > 0 && " and "}
              {revenue > 0 && (
                <>
                  <span className="tabular-nums text-ink-2">{sar(revenue)}</span> in revenue
                </>
              )}
              {" so far — nothing to pace it against yet."}
            </p>
          )}
          {canManage ? (
            seedMonth ? (
              <p className="mt-1">
                {monthLabel(seedMonth)} has one — carry it over, or plan this month from scratch.
              </p>
            ) : (
              <p className="mt-1">
                Head to the{" "}
                <Link href={planHref} className="underline hover:text-ink">
                  Plan page
                </Link>{" "}
                to add allocations.
              </p>
            )
          ) : (
            <p className="mt-1">Ask someone with budget access to add a plan.</p>
          )}
        </>
      }
      action={
        canManage && seedMonth ? (
          <>
            <Button asChild size="sm">
              <Link href={planHref}>Plan {monthLabel(month)}</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/budget?month=${seedMonth}`}>See {monthLabel(seedMonth)}</Link>
            </Button>
          </>
        ) : undefined
      }
    />
  );
}
