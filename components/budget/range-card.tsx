"use client";

import { fxRate, monthDay, roas as fmtRoas, sar } from "@/lib/format";
import { pacingDeviation, type TrackerBar } from "@/lib/budget";
import type { RangeCardData } from "@/lib/budget-range";
import { Hero, HeroVerdict, PaceBar, anchorWords } from "@/components/budget/budget-shared";

/**
 * The hero card for a date range — Today draws three (spend · revenue · ROAS
 * for the month), Analysis one (the metric in view). Moved out of the Pacing
 * component (2026-11-14) so both pages draw the SAME card from the same
 * `RangeCardData` (`lib/budget-range.ts`).
 */
export type RangeMetric = "spend" | "revenue" | "roas";

/**
 * The ROAS card's bar: a ratio against a target, so plan = tick = the target
 * and there is no verdict before any spend (actual null).
 */
function roasBar(target: number, actual: number | null): TrackerBar {
  return {
    key: "roas",
    label: "ROAS",
    plan: target,
    actual: actual ?? 0,
    planToDate: target,
    delta: (actual ?? 0) - target,
    deviation: actual === null ? null : pacingDeviation(actual, target),
  };
}

/**
 * Today's hero card, for a date range: the big number is the range's
 * actual, the context says what was planned for the range, ONE PaceBar
 * (track = the range's plan, fill = actual, tick = expected through coverage,
 * pale extension = projection) and the verdict line. A fully covered range
 * is "final for <range>"; a range with no plan shows the number and says so.
 */
export function RangeCard({
  metric,
  title,
  card,
  fmtSpend,
  rate,
}: {
  metric: RangeMetric;
  title: string;
  card: RangeCardData;
  fmtSpend: (usd: number) => string;
  rate: number;
}) {
  if (metric === "roas") {
    const r = card.roas;
    const rateNote = `at ${fxRate(rate)} SAR/USD`;
    if (r.target === null) {
      return (
        <Hero
          label="ROAS"
          value={fmtRoas(r.actual)}
          context={<>no plan for this range · {rateNote}</>}
        />
      );
    }
    const actual = r.actual ?? 0;
    const scale = Math.max(actual, r.target, r.projected ?? 0) * 1.15;
    const bar = roasBar(r.target, r.actual);
    if (r.state === "future") {
      return (
        <Hero
          label="ROAS"
          value={fmtRoas(r.target)}
          aside={<span className="text-[11px] text-ink-3">on plan</span>}
          context={<>for {title} · {rateNote}</>}
        >
          <div className="mt-3">
            <PaceBar bar={bar} fmt={fmtRoas} name="ROAS" scale={scale} anchor="when it starts" />
          </div>
        </Hero>
      );
    }
    return (
      <Hero
        label="ROAS"
        value={fmtRoas(r.actual)}
        context={
          <>
            on plan <span className="tabular-nums text-ink-2">{fmtRoas(r.target)}</span> for{" "}
            {title} · {rateNote}
          </>
        }
      >
        <div className="mt-3">
          <PaceBar
            bar={bar}
            fmt={fmtRoas}
            name="ROAS"
            scale={scale}
            projection={r.state === "live" ? r.projected : null}
            anchor={anchorWords(r.through, r.lastData)}
          />
        </div>
        <HeroVerdict
          bar={bar}
          fmt={fmtRoas}
          projected={r.state === "live" ? r.projected : null}
          state={r.state}
          finalLabel={title}
          variant="target"
          vsLabel="vs plan"
        />
      </Hero>
    );
  }

  const side = metric === "revenue" ? card.revenue : card.spend;
  const fmt = metric === "revenue" ? sar : fmtSpend;
  const label = metric === "revenue" ? "Revenue" : "Spend";
  const { bar } = side;
  if (bar.plan <= 0) {
    return <Hero label={label} value={fmt(bar.actual)} context="no plan for this range" />;
  }
  if (side.state === "future") {
    return (
      <Hero
        label={label}
        value={fmt(bar.plan)}
        aside={<span className="text-[11px] text-ink-3">planned</span>}
        context={<>for {title}</>}
      >
        <div className="mt-3">
          <PaceBar bar={bar} fmt={fmt} name={label} anchor="when it starts" />
        </div>
      </Hero>
    );
  }
  return (
    <Hero
      label={label}
      value={fmt(bar.actual)}
      context={
        <>
          of <span className="tabular-nums text-ink-2">{fmt(bar.plan)}</span> planned for {title}
        </>
      }
    >
      <div className="mt-3">
        <PaceBar
          bar={bar}
          fmt={fmt}
          name={label}
          projection={side.state === "live" ? side.projected : null}
          anchor={anchorWords(side.through, side.lastData)}
        />
      </div>
      {side.unplanned.months > 0 ? (
        // Part of the range has actuals and no plan: the bar still shows the
        // range's plan against everything that happened, but a verdict and a
        // projection over that comparison would be noise — say why instead.
        <p className="mt-2 text-xs text-ink-3">
          <span className="tabular-nums text-ink-2">{fmt(side.unplanned.amount)}</span> of it
          fell in {side.unplanned.months === 1 ? "a month" : `${side.unplanned.months} months`}{" "}
          with no plan — nothing to pace the whole range against.
        </p>
      ) : (
        <HeroVerdict
          bar={bar}
          fmt={fmt}
          projected={side.projected}
          state={side.state}
          finalLabel={title}
          vsLabel={metric === "revenue" ? "vs target" : "vs plan"}
        />
      )}
    </Hero>
  );
}

/**
 * "Sep 1 – Sep 30" within a year; "Oct 1, 2025 – Sep 30, 2026" across one.
 * A twelve-month range labelled without years reads as nine days.
 */
export function rangeTitle(from: string, to: string): string {
  if (from.slice(0, 4) === to.slice(0, 4)) return `${monthDay(from)} – ${monthDay(to)}`;
  return `${monthDay(from)}, ${from.slice(0, 4)} – ${monthDay(to)}, ${to.slice(0, 4)}`;
}
