"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PlatformDot } from "@/components/ui/platform-dot";
import { PLATFORM_LABEL } from "@/lib/palette";
import { sar, signedPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  buildTrackerRows,
  monthLabel,
  pacingTone,
  type TrackerBar,
} from "@/lib/budget";
import type { BudgetMonthData } from "@/db/queries/budget";
import {
  BudgetMonthBar,
  CurrencyToggle,
  HorizonNote,
  formatSpend,
  platformLabel,
  useBudgetCurrency,
} from "@/components/budget/budget-shared";

/**
 * Budget → Tracker: the zero-configuration daily pace board. One question —
 * who's ahead, who's behind, by how much — answered with bars instead of
 * tables. There are NO controls beyond the month and the currency: that
 * absence is the feature (Pacing is the tool you reach for when you want to
 * slice something).
 *
 * Every number comes from `buildTrackerRows` (pure, unit-tested) which in turn
 * composes the module's one set of conventions — the plan curve, the
 * magnitude-based pacing tone, the actual ÷ elapsed-curve projection. Nothing
 * here re-derives pacing.
 */
export function BudgetTracker({
  month,
  today,
  data,
  horizon,
  storeHorizon,
  canManage,
}: {
  month: string; // YYYY-MM
  today: string; // ISO date
  data: BudgetMonthData;
  horizon: string | null;
  /** The STORE horizon — the revenue bar's side of the picture. */
  storeHorizon: string | null;
  canManage: boolean;
}) {
  const [currency, pickCurrency] = useBudgetCurrency();
  const rate = data.usdToSarRate;
  const fmtSpend = (usdAmount: number) => formatSpend(usdAmount, currency, rate);

  const t = buildTrackerRows(data, month, today);

  return (
    <div className="space-y-4">
      <BudgetMonthBar month={month} today={today}>
        <CurrencyToggle currency={currency} onChange={pickCurrency} />
      </BudgetMonthBar>

      {!t.hasPlan ? (
        <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center">
          <p className="text-sm text-ink-2">
            Nothing to track — {monthLabel(month)} has no plan yet.
          </p>
          <p className="mt-1 text-xs text-ink-3">
            The Tracker paces spend against a plan; set one and this page fills
            itself in.
          </p>
          {canManage && (
            <Button asChild size="sm" className="mt-3">
              <Link href={`/budget/plan?month=${month}`}>
                Plan {monthLabel(month)}
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* ── Header strip: where the month is, and where it's heading ── */}
          <section className="rounded-lg border border-line bg-surface px-4 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-sm text-ink">
                {t.isFutureMonth ? (
                  <>Not started — {monthLabel(month)} is ahead of us</>
                ) : (
                  <>
                    Day{" "}
                    <span className="num tabular-nums">{t.elapsedDays}</span> of{" "}
                    <span className="num tabular-nums">{t.totalDays}</span>
                    <span className="text-ink-3">
                      {" · plan expects "}
                      <span className="num tabular-nums">
                        {Math.round(t.curveElapsed * 100)}%
                      </span>
                      {" spent"}
                    </span>
                  </>
                )}
              </p>
              <Verdict bar={t.total} fmt={fmtSpend} />
            </div>

            <div className="mt-3">
              <PaceBar bar={t.total} fmt={fmtSpend} name="Total" />
            </div>

            <p className="mt-2 text-xs text-ink-3">
              <span className="num tabular-nums text-ink-2">
                {fmtSpend(t.total.actual)}
              </span>{" "}
              of{" "}
              <span className="num tabular-nums text-ink-2">
                {fmtSpend(t.total.plan)}
              </span>
              {t.isPastMonth ? (
                // The month is over: final vs plan, no extrapolation.
                <> — final for {monthLabel(month)}</>
              ) : (
                t.projectedSpend !== null && (
                  <>
                    {" — on this pace the month ends at "}
                    <span
                      className={cn(
                        "num tabular-nums",
                        pacingTone(t.projectedPctOfPlan === null ? null : t.projectedPctOfPlan - 1) ===
                          "warn"
                          ? "text-warn"
                          : "text-ink-2",
                      )}
                    >
                      {fmtSpend(t.projectedSpend)}
                    </span>
                    {t.total.plan > 0 && (
                      <>
                        {" of "}
                        <span className="num tabular-nums text-ink-2">
                          {fmtSpend(t.total.plan)}
                        </span>
                        {" ("}
                        <span className="num tabular-nums">
                          {Math.round((t.projectedPctOfPlan ?? 0) * 100)}%
                        </span>
                        {")"}
                      </>
                    )}
                  </>
                )
              )}
            </p>
          </section>

          {/* ── Platform cards: the plan editor's 2×2 grid, stacked on a phone ── */}
          {t.platforms.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2">
              {t.platforms.map((p) => (
                <li
                  key={p.key}
                  className="rounded-lg border border-line bg-surface px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className="inline-flex items-center gap-2 text-sm font-medium text-ink">
                      <PlatformDot platform={p.key as never} size="sm" />
                      {PLATFORM_LABEL[p.key as keyof typeof PLATFORM_LABEL] ??
                        platformLabel(p.key)}
                    </span>
                    <Verdict bar={p} fmt={fmtSpend} />
                  </div>

                  {p.plan > 0 && (
                    <div className="mt-2">
                      <PaceBar bar={p} fmt={fmtSpend} name={platformLabel(p.key)} />
                      <Amounts bar={p} fmt={fmtSpend} />
                    </div>
                  )}

                  {p.buckets.length > 0 && (
                    <ul className="mt-3 space-y-2.5 border-t border-line pt-3">
                      {p.buckets.map((b) => (
                        <li key={b.key}>
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                            <span className="text-xs text-ink-2">{b.label}</span>
                            <Verdict bar={b} fmt={fmtSpend} small />
                          </div>
                          <div className="mt-1">
                            <PaceBar bar={b} fmt={fmtSpend} name={b.label} small />
                            <Amounts bar={b} fmt={fmtSpend} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  {p.unplanned > 0 && (
                    // No bar: there is no plan to bar against. The words carry
                    // the meaning — this money comes out of the reserve.
                    <p className="mt-3 border-t border-line pt-2 text-xs text-ink-3">
                      Unplanned{" "}
                      <span className="num tabular-nums text-ink-2">
                        {fmtSpend(p.unplanned)}
                      </span>{" "}
                      — draws down the reserve
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* ── Footer: the reserve, and the one revenue bar ── */}
          <section className="space-y-3 rounded-lg border border-line bg-surface px-4 py-3">
            <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs">
              <span className="text-ink-2">
                Reserve{" "}
                <span className="num tabular-nums text-ink">
                  {fmtSpend(t.reserveRemaining)}
                </span>{" "}
                left of{" "}
                <span className="num tabular-nums">{fmtSpend(t.reserve)}</span>
                <span className="text-ink-3"> — carved out of the total</span>
              </span>
              <span
                className={cn(
                  "num tabular-nums",
                  t.unplannedTotal > t.reserve ? "text-warn" : "text-ink-3",
                )}
              >
                Unplanned spend {fmtSpend(t.unplannedTotal)}
                {t.unplannedTotal > t.reserve && " — past the reserve"}
              </span>
            </p>

            {t.revenue.target !== null && (
              <div className="border-t border-line pt-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-xs text-ink-2">Revenue (SAR)</span>
                  <Verdict bar={t.revenue} fmt={sar} small />
                </div>
                <div className="mt-1">
                  <PaceBar bar={t.revenue} fmt={sar} name="Revenue" />
                  <Amounts bar={t.revenue} fmt={sar} />
                </div>
              </div>
            )}
          </section>
        </>
      )}

      {/* Ads and store data arrive on separate schedules, and this page reads
          both — a later day is not a zero, just not uploaded yet. */}
      <HorizonNote horizon={horizon} storeHorizon={storeHorizon} />
    </div>
  );
}

/** Share of the track a value occupies, clamped to [0, 100]. */
function pctOfPlan(value: number, plan: number): number {
  if (plan <= 0) return 0;
  return Math.max(0, Math.min(100, (value / plan) * 100));
}

/**
 * THE BAR. Pure CSS, no chart library: the track is the row's FULL month plan,
 * the fill is the actual so far, and the tick is where the plan curve says we
 * should be today. Warn-tinted by |deviation| through the shared threshold —
 * ahead and behind are both deviations, never good/bad green/red.
 *
 * The aria-label says the whole thing in words, because a bar a screen reader
 * can't read is decoration.
 */
function PaceBar({
  bar,
  fmt,
  name,
  small = false,
}: {
  bar: TrackerBar;
  fmt: (v: number) => string;
  name: string;
  small?: boolean;
}) {
  const fill = pctOfPlan(bar.actual, bar.plan);
  const tick = pctOfPlan(bar.planToDate, bar.plan);
  const warn = pacingTone(bar.deviation) === "warn";
  const words = `${name}: ${fmt(bar.actual)} of ${fmt(bar.plan)}, should be ${fmt(
    bar.planToDate,
  )} by today${
    bar.deviation === null
      ? ""
      : bar.delta === 0
        ? " — on track"
        : ` — ${bar.delta > 0 ? "ahead" : "behind"} ${fmt(Math.abs(bar.delta))}`
  }`;
  return (
    <div
      role="img"
      aria-label={words}
      title={words}
      className={cn(
        "relative w-full rounded-full bg-surface-2",
        small ? "h-1.5" : "h-2",
      )}
    >
      <div
        className={cn(
          "absolute inset-y-0 left-0 rounded-full transition-[width]",
          warn ? "bg-warn" : "bg-brand",
        )}
        style={{ width: `${fill}%` }}
      />
      {/* The curve's mark for today — the whole point of the bar, so it stands
          slightly PROUD of the track (and is 2px wide) instead of vanishing
          under the fill when the two coincide. Hidden at 0: a future month
          expects nothing, and a mark at the origin would read as a sliver. */}
      {tick > 0 && (
        <div
          className="absolute -inset-y-1 w-0.5 -translate-x-px rounded-full bg-ink-3"
          style={{ left: `${tick}%` }}
        />
      )}
    </div>
  );
}

/** "$8,140 of $18,000" — wraps as a pair on a phone. */
function Amounts({ bar, fmt }: { bar: TrackerBar; fmt: (v: number) => string }) {
  return (
    <p className="mt-1 text-[11px] text-ink-3">
      <span className="num tabular-nums text-ink-2">{fmt(bar.actual)}</span> of{" "}
      <span className="num tabular-nums">{fmt(bar.plan)}</span>
    </p>
  );
}

/**
 * "▲ ahead $1,860 (+31%)" / "▼ behind …" / "on track" / "—". Warn-tinted by
 * MAGNITUDE (the shared `pacingTone`), so neither direction reads as good news.
 */
function Verdict({
  bar,
  fmt,
  small = false,
}: {
  bar: TrackerBar;
  fmt: (v: number) => string;
  small?: boolean;
}) {
  const warn = pacingTone(bar.deviation) === "warn";
  const cls = cn(
    "num tabular-nums",
    small ? "text-[11px]" : "text-xs",
    warn ? "text-warn" : "text-ink-3",
  );
  // No expectation yet (future month, or nothing planned) → no verdict at all.
  if (bar.deviation === null) return <span className={cls}>—</span>;
  if (Math.round(bar.delta) === 0) return <span className={cls}>on track</span>;
  // The percentage IS the deviation — one source, not a second derivation.
  const pct = bar.deviation;
  const ahead = bar.delta > 0;
  return (
    <span className={cls}>
      {ahead ? "▲" : "▼"} {ahead ? "ahead" : "behind"} {fmt(Math.abs(bar.delta))}
      {pct !== null && ` (${signedPct(pct, 0)})`}
    </span>
  );
}
