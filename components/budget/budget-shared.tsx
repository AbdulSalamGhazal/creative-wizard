"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { displayValueFontSize } from "@/components/overview/metric-card";
import { longDate, sar, signedPct, usd } from "@/lib/format";
import { PLATFORM_LABEL } from "@/lib/palette";
import { cn } from "@/lib/utils";
import {
  monthKey,
  monthLabel,
  nextMonthKey,
  pacingTone,
  pacingVerdict,
  prevMonthKey,
  spendInDisplayCurrency,
  variancePct,
  type CoverageSummary,
  type TrackerBar,
  type TrackerData,
} from "@/lib/budget";
import { useNavTransition } from "@/lib/nav-progress";
import { SegmentedControl } from "@/components/ui/segmented-control";

/**
 * Shared client-side plumbing for the Budget pages: the month bar (with a year
 * dropdown), the per-user display-currency toggle, the data-horizon note, and
 * the pacing-deviation cell. Keeping these here means the pages can't drift
 * apart on month navigation, currency semantics or how a deviation reads.
 */

export type BudgetCurrency = "USD" | "SAR";
const CURRENCY_KEY = "cw-budget-currency";

/** Display-currency preference (display-only → localStorage, like v1). */
export function useBudgetCurrency(): [BudgetCurrency, (c: BudgetCurrency) => void] {
  const [currency, setCurrency] = useState<BudgetCurrency>("USD");
  useEffect(() => {
    try {
      const stored = localStorage.getItem(CURRENCY_KEY);
      if (stored === "SAR" || stored === "USD") setCurrency(stored);
    } catch {
      /* keep USD */
    }
  }, []);
  const pick = (c: BudgetCurrency) => {
    setCurrency(c);
    try {
      localStorage.setItem(CURRENCY_KEY, c);
    } catch {
      /* ignore */
    }
  };
  return [currency, pick];
}

/** Format a USD spend figure in the chosen display currency via the rate. */
export function formatSpend(usdAmount: number, currency: BudgetCurrency, rate: number): string {
  return currency === "SAR"
    ? sar(spendInDisplayCurrency(usdAmount, "SAR", rate))
    : usd(usdAmount);
}

/** The USD / SAR segmented toggle. */
export function CurrencyToggle({
  currency,
  onChange,
}: {
  currency: BudgetCurrency;
  onChange: (c: BudgetCurrency) => void;
}) {
  return (
    <SegmentedControl<BudgetCurrency>
      ariaLabel="Display currency"
      value={currency}
      onChange={onChange}
      options={[
        { value: "USD", label: "USD" },
        { value: "SAR", label: "SAR" },
      ]}
    />
  );
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * The month bar every Budget page shares: ‹ › steppers, the month name, a year
 * dropdown, and a "Today" shortcut off the current month. Navigates by
 * replacing `?month=` on the CURRENT pathname, so each page keeps its own
 * route. `children` is the page's right-side control cluster.
 */
export function BudgetMonthBar({
  month,
  today,
  children,
  locked = false,
  onMonthChange,
}: {
  month: string; // YYYY-MM
  today: string; // ISO date
  children?: React.ReactNode;
  /** Freeze month navigation — an open draft belongs to THIS month. */
  locked?: boolean;
  /**
   * Write the month yourself. The default push REPLACES the query with
   * `?month=`, which is right for a page whose only state is the month — but
   * a page with view state (the Tracker) must keep it, so it hands the write
   * to its own params writer instead.
   */
  onMonthChange?: (month: string) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startNav] = useNavTransition();
  const go = (m: string) => {
    if (locked) return;
    if (onMonthChange) {
      onMonthChange(m);
      return;
    }
    startNav(() => router.replace(`${pathname}?month=${m}`, { scroll: false }));
  };
  const lockedTitle = locked ? "Finish editing first" : undefined;

  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthName = MONTH_NAMES[Number(monthStr) - 1] ?? month;
  const currentYear = Number(today.slice(0, 4));
  // A window wide enough for history and forward planning without a free-text
  // input: 3 years back, 1 forward (union'd with the shown year so an odd URL
  // never renders an empty dropdown).
  const years = Array.from(
    new Set([year, ...Array.from({ length: 5 }, (_, i) => currentYear - 3 + i)]),
  ).sort((a, b) => a - b);

  const isCurrentMonth = monthKey(today) === month;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => go(prevMonthKey(month))}
          aria-label="Previous month"
          disabled={locked}
          title={lockedTitle}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="min-w-[6.5rem] text-center font-display text-lg">{monthName}</span>
        <Select
          value={String(year)}
          onValueChange={(y) => go(`${y}-${monthStr}`)}
          disabled={locked}
        >
          <SelectTrigger
            className="h-7 w-[5.4rem] text-sm num"
            aria-label="Year"
            title={lockedTitle}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => go(nextMonthKey(month))}
          aria-label="Next month"
          disabled={locked}
          title={lockedTitle}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        {!isCurrentMonth && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => go(monthKey(today))}
            disabled={locked}
            title={lockedTitle}
          >
            Today
          </Button>
        )}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/**
 * The shared "data through …" note (Overview + Pacing). Ads and store uploads
 * arrive separately, so pass `storeHorizon` wherever BOTH sides are shown
 * (Daily) — the two dates are genuinely different and a single date would
 * misdescribe one of them.
 */
export function HorizonNote({
  horizon,
  storeHorizon,
}: {
  horizon: string | null;
  storeHorizon?: string | null;
}) {
  if (!horizon && !storeHorizon) return null;
  return (
    <p className="text-[11px] text-ink-3">
      {horizon && <>Ad data through {longDate(horizon)}</>}
      {horizon && storeHorizon !== undefined && storeHorizon && " · "}
      {storeHorizon && <>Store data through {longDate(storeHorizon)}</>}
      {" — later days aren’t zero, just not uploaded yet."}
    </p>
  );
}

/**
 * One pacing deviation, warn-tinted by MAGNITUDE — over- and under-pace are
 * both deviations, never good/bad green/red. Every Budget surface renders a
 * deviation through this, so the threshold and the wording can't drift.
 */
export function PacingDevCell({ deviation }: { deviation: number | null }) {
  return (
    <span
      className={cn(
        "num text-xs",
        pacingTone(deviation) === "warn" ? "text-warn" : "text-ink-3",
      )}
    >
      {pacingVerdict(deviation)}
    </span>
  );
}

/** A platform's display label, falling back to its raw key. */
export function platformLabel(platform: string): string {
  return PLATFORM_LABEL[platform as keyof typeof PLATFORM_LABEL] ?? platform;
}

/** Anchor id for a platform's group on the Plan page (Overview cards link here). */
export function platformAnchorId(platform: string): string {
  return `platform-${platform}`;
}

/**
 * Phone + keyboard flow for a form full of numeric fields (the Plan editor's
 * cascade, the Audience record grid).
 *
 * One ref goes on the form container; every field spreads `fieldProps`. Enter
 * walks to the next `[data-budget-field]` in DOM order — which both callers
 * keep as the visual order — skipping disabled fields; Escape blurs; focus
 * selects, so a correction overwrites instead of appending to what's there.
 */
export function useFieldFlow(inputMode: "decimal" | "numeric" = "decimal") {
  const formRef = useRef<HTMLDivElement>(null);
  const fieldProps = {
    inputMode,
    "data-budget-field": true,
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => e.currentTarget.select(),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.currentTarget.blur();
        return;
      }
      if (e.key !== "Enter") return;
      e.preventDefault();
      const fields = Array.from(
        formRef.current?.querySelectorAll<HTMLInputElement>("[data-budget-field]") ?? [],
      ).filter((el) => !el.disabled);
      const next = fields[fields.indexOf(e.currentTarget) + 1];
      if (next) {
        next.focus();
        next.select();
      } else {
        e.currentTarget.blur();
      }
    },
  };
  return { formRef, fieldProps };
}

/**
 * A numeric field with its unit INSIDE the box — the Budget module's house
 * money input. Shared by the Plan cascade and the CSV upload dialog so the
 * two never drift on padding or the unit's weight.
 */
export function UnitInput({
  unit,
  title,
  wrapperClassName,
  className,
  ...props
}: React.ComponentProps<typeof Input> & { unit: string; wrapperClassName?: string }) {
  return (
    <div className={cn("relative", wrapperClassName)} title={title}>
      <Input
        {...props}
        className={cn("peer text-right num", unit.length > 1 ? "pr-11" : "pl-2 pr-6", className)}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[11px] text-ink-3 peer-disabled:opacity-50"
      >
        {unit}
      </span>
    </div>
  );
}

/**
 * One bar per day of the month, height = that day's planned money — the Plan
 * tab's day-grain chart. Lifted out of the curve editor so the daily-mode tab
 * and the upload preview draw the SAME bars: a month planned either way reads
 * the same. Interactive only when `onSelectDay` is given.
 */
export function PlanDayBars({
  values,
  label,
  emphasize,
  selectedDay = null,
  onSelectDay,
  ariaLabel,
  className,
  tone = "muted",
}: {
  /**
   * `muted`: the curve editor's reading — a grey bar is an ORDINARY day and the
   * brand tint marks a weighted one. `data`: every bar IS the plan (a daily
   * month, the upload preview), so every bar carries the brand — grey bars
   * measured 1.2:1 on the dialog's background and all but vanished.
   */
  tone?: "muted" | "data";
  /** Per day, index 0 = day 1. */
  values: readonly number[];
  /** A day's value as text (tooltips + aria). */
  label: (value: number) => string;
  /** Days drawn in the brand tint (weighted days on a curve). */
  emphasize?: (day: number) => boolean;
  selectedDay?: number | null;
  onSelectDay?: (day: number | null) => void;
  ariaLabel: string;
  className?: string;
}) {
  const peak = Math.max(...values, 0) || 1;
  return (
    <div className={cn("flex h-28 items-end gap-px", className)} role="img" aria-label={ariaLabel}>
      {values.map((value, i) => {
        const day = i + 1;
        const selected = selectedDay === day;
        // Data bars are FULL brand — the only fill that clears 3:1 against both
        // the panel and the dialog on all four themes (measured: 3.59–9.78;
        // /70 fell to 2.3 on Midnight) — so selection there switches to ink.
        const fill =
          tone === "data"
            ? selected
              ? "bg-ink"
              : "bg-[var(--brand)]"
            : selected
              ? "bg-[var(--brand)]"
              : emphasize?.(day)
                ? "bg-[var(--brand)]/60"
                : "bg-surface-3";
        const style = { height: `${Math.max(3, (value / peak) * 100)}%` };
        const title = `Day ${day} · ${label(value)}`;
        return onSelectDay ? (
          <button
            key={day}
            type="button"
            onClick={() => onSelectDay(selected ? null : day)}
            title={title}
            aria-label={title}
            className={cn(
              "min-w-0 flex-1 cursor-pointer rounded-t-[2px] transition-all hover:bg-[var(--brand)]/40",
              fill,
            )}
            style={style}
          />
        ) : (
          <div
            key={day}
            title={title}
            className={cn("min-w-0 flex-1 rounded-t-[2px]", fill)}
            style={style}
          />
        );
      })}
    </div>
  );
}

// ── The pace bar and its words (lifted from the Tracker, 2026-10) ───────────
// The Overview's pace board and hero cards draw the SAME bar the Tracker does,
// so the three pieces live here and both pages import them — extend, never
// fork. The hero cards needed three things the Tracker's rows never did (a
// projection extension, a reserve tail, a ratio scale), so those are optional
// props on the one component rather than a second bar.

/** Share of the scale a value occupies, clamped to [0, 100]. */
function pctOfScale(value: number, scale: number): number {
  if (scale <= 0) return 0;
  return Math.max(0, Math.min(100, (value / scale) * 100));
}

/**
 * THE BAR. Pure CSS, no chart library: the track is the row's FULL month plan,
 * the fill is the actual so far, and the tick is where the plan curve says we
 * should be today. Warn-tinted by |deviation| through the shared threshold —
 * ahead and behind are both deviations, never good/bad green/red.
 *
 * Optional, for the Overview's hero cards: `projection` draws a paler
 * extension from the fill's end to the month-end projection; `reserve` adds a
 * dashed tail after the plan's end (the reserve carved out beyond the
 * allocated plan — the fill may run into it); `scale` replaces the cumulative
 * track with a plain 0..scale axis (a ratio like ROAS has no month to fill,
 * so the whole width is the scale and the tick is the target); `tone` forces
 * the tint where there is no deviation to judge (the reserve row).
 *
 * The aria-label says the whole thing in words, because a bar a screen reader
 * can't read is decoration.
 */
export function PaceBar({
  bar,
  fmt,
  name,
  small = false,
  anchor = "by today",
  projection = null,
  reserve = 0,
  scale,
  tone,
  words: wordsOverride,
}: {
  bar: TrackerBar;
  fmt: (v: number) => string;
  name: string;
  small?: boolean;
  /** What the expectation is measured THROUGH — coverage, not the calendar. */
  anchor?: string;
  /** Replace the spoken label entirely (a bar whose track is not a plan). */
  words?: string;
  /** Month-end projection; drawn only when it runs past the fill. */
  projection?: number | null;
  /** A reserve beyond the plan — the dashed tail. */
  reserve?: number;
  /** A ratio's axis: the bar runs 0..scale and the track spans all of it. */
  scale?: number;
  /** Override the tint when the row has no deviation of its own to judge. */
  tone?: "muted" | "warn";
}) {
  const max = scale ?? bar.plan + reserve;
  const trackPct = scale !== undefined || reserve <= 0 ? 100 : pctOfScale(bar.plan, max);
  const fill = pctOfScale(bar.actual, max);
  const tick = pctOfScale(bar.planToDate, max);
  const projected =
    projection !== null && projection > bar.actual ? pctOfScale(projection, max) : null;
  const warn = (tone ?? pacingTone(bar.deviation)) === "warn";
  const words =
    wordsOverride ??
    `${name}: ${fmt(bar.actual)} of ${fmt(bar.plan)}, should be ${fmt(bar.planToDate)} ${anchor}${
    bar.deviation === null
      ? ""
      : bar.delta === 0
        ? " — on track"
        : ` — ${bar.delta > 0 ? "ahead" : "behind"} ${fmt(Math.abs(bar.delta))}`
  }${projection !== null ? `; projected to end at ${fmt(projection)}` : ""}${
    reserve > 0 ? `; ${fmt(reserve)} reserve beyond the plan` : ""
  }`;
  return (
    <div
      role="img"
      aria-label={words}
      title={words}
      className={cn("relative w-full", small ? "h-1.5" : "h-2")}
    >
      {/* The track: the plan (or the whole axis, for a ratio). */}
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-surface-2"
        style={{ width: `${trackPct}%` }}
      />
      {/* The reserve tail: money carved out beyond the plan — an outline, not
          a track, because nothing is EXPECTED to be spent there. */}
      {trackPct < 100 && (
        <div
          className="absolute inset-y-0 right-0 rounded-full border border-dashed border-line-2"
          style={{ left: `calc(${trackPct}% + 2px)` }}
        />
      )}
      {/* The projection: where this pace lands, paler than what has happened. */}
      {projected !== null && projected > fill && (
        <div
          className={cn("absolute inset-y-0 rounded-r-full", warn ? "bg-warn/30" : "bg-brand/30")}
          style={{ left: `${fill}%`, width: `${projected - fill}%` }}
        />
      )}
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
export function Amounts({ bar, fmt }: { bar: TrackerBar; fmt: (v: number) => string }) {
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
 * `variant="target"` is the ROAS card's reading of the same deviation — "above
 * target by 0.12× (+14%)" / "on target" — a ratio against a target, not a
 * cumulative against a curve.
 */
export function Verdict({
  bar,
  fmt,
  small = false,
  variant = "pace",
}: {
  bar: TrackerBar;
  fmt: (v: number) => string;
  small?: boolean;
  variant?: "pace" | "target";
}) {
  const warn = pacingTone(bar.deviation) === "warn";
  const cls = cn(
    "num tabular-nums",
    small ? "text-[11px]" : "text-xs",
    warn ? "text-warn" : "text-ink-3",
  );
  // No expectation yet (future month, or nothing planned) → no verdict at all.
  if (bar.deviation === null) return <span className={cls}>—</span>;
  // Zero is judged by what will be SHOWN: whole dollars on a pace bar, the
  // ratio's own formatted precision on a target.
  const onTrack =
    variant === "target"
      ? fmt(Math.abs(bar.delta)) === fmt(0)
      : Math.round(bar.delta) === 0;
  if (onTrack) {
    return <span className={cls}>{variant === "target" ? "on target" : "on track"}</span>;
  }
  // The percentage IS the deviation — one source, not a second derivation.
  const pct = bar.deviation;
  const ahead = bar.delta > 0;
  const words =
    variant === "target"
      ? ahead
        ? "above target by"
        : "below target by"
      : ahead
        ? "▲ ahead"
        : "▼ behind";
  return (
    <span className={cls}>
      {words} {fmt(Math.abs(bar.delta))}
      {pct !== null && ` (${signedPct(pct, 0)})`}
    </span>
  );
}

// ── What the comparisons counted through (2026-10) ──────────────────────────
// The Tracker's header and the Overview's month bar name the SAME anchor in
// the same words, from the same `buildTrackerRows` output — so the two pages
// can never disagree about which day the month was judged through.

/**
 * "Day N of M · data through D" (or "Not started — <Month> is ahead of us").
 * `children` is the page's own addition on the same line (the Tracker's
 * "plan expects P% spent"); the wrapper's text size comes from `className`.
 */
export function CoverageLine({
  t,
  children,
  className,
}: {
  t: Pick<TrackerData, "month" | "elapsedDays" | "totalDays" | "coverage" | "isFutureMonth">;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("text-sm text-ink", className)}>
      {t.isFutureMonth ? (
        <>Not started — {monthLabel(t.month)} is ahead of us</>
      ) : (
        <>
          Day <span className="num tabular-nums">{t.elapsedDays}</span> of{" "}
          <span className="num tabular-nums">{t.totalDays}</span>
          {/* What the comparisons actually counted through — the last
              uploaded day, not today. */}
          {t.coverage?.through && (
            <span className="text-ink-3">
              {" · data through "}
              <span className="num tabular-nums">{t.coverage.through}</span>
            </span>
          )}
          {children}
        </>
      )}
    </p>
  );
}

/** "TikTok data ends 2026-09-13 · Google data hasn't arrived" — or "". */
export function laggardWords(laggards: CoverageSummary["laggards"]): string {
  return laggards
    .map(
      (l) =>
        `${platformLabel(l.platform)} data ${l.date ? `ends ${l.date}` : "hasn’t arrived"}`,
    )
    .join(" · ");
}

/**
 * One platform's data lagging the rest changes what its row is compared
 * against, so the page says which one rather than leaving a quietly different
 * yardstick unexplained. Renders nothing when nobody lags.
 */
export function CoverageLaggards({
  coverage,
  className,
}: {
  coverage: CoverageSummary | null;
  className?: string;
}) {
  if (!coverage || coverage.laggards.length === 0) return null;
  return (
    <p className={cn("text-[11px] text-ink-3", className)}>
      {laggardWords(coverage.laggards)}
      {" — paced against what each one covers"}
    </p>
  );
}

// ── The hero card (lifted from the Overview, 2026-10) ────────────────────────
// The Overview's three hero cards and the Pacing page's range card are ONE
// card: a label row, the big number, its context line, a PaceBar and a verdict
// line. It lives here so the two pages cannot drift.

/** Where the thing being paced stands in time. */
export type HeroState = "live" | "final" | "future";

/**
 * The card shell: a label row (with an optional aside, like the order count),
 * the big number, its context line, then whatever the metric adds — a bar
 * and a verdict. Sized like the Dashboard's KPI tiles so the number never
 * wraps at 375px.
 */
export function Hero({
  label,
  value,
  aside,
  context,
  children,
}: {
  label: string;
  value: string;
  aside?: ReactNode;
  context: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="@container min-w-0 rounded-lg border border-line bg-surface px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-label text-ink-3">{label}</span>
        {aside}
      </div>
      <div
        className="mt-1.5 whitespace-nowrap font-display leading-none num tabular-nums text-ink"
        style={{ fontSize: displayValueFontSize(value, "2.2rem") }}
      >
        {value}
      </div>
      <p className="mt-1 text-xs text-ink-3">{context}</p>
      {children}
    </section>
  );
}

/**
 * "▲ ahead $X (+Y%) · projected $Z (+W% vs plan, within reserve)" while the
 * thing is LIVE; "final for <label>" once it is over; nothing before it
 * starts. The projection is judged against the plan with the shared magnitude
 * tone; the reserve note says whether an overshoot still fits inside the
 * money held back.
 */
export function HeroVerdict({
  bar,
  fmt,
  projected,
  reserve = 0,
  state,
  finalLabel,
  variant = "pace",
  vsLabel = "vs plan",
}: {
  bar: TrackerBar;
  fmt: (v: number) => string;
  projected: number | null;
  reserve?: number;
  state: HeroState;
  /** What "final for …" names — a month, or a range title. */
  finalLabel: string;
  variant?: "pace" | "target";
  vsLabel?: string;
}) {
  if (state === "final") {
    return <p className="mt-2 text-xs text-ink-3">final for {finalLabel}</p>;
  }
  if (state !== "live") return null;
  const pct = projected !== null && bar.plan > 0 ? variancePct(projected, bar.plan) : null;
  // The reserve exists to absorb exactly this overshoot — say whether it does.
  const reserveNote =
    projected !== null && reserve > 0 && bar.plan > 0 && projected > bar.plan
      ? projected <= bar.plan + reserve
        ? ", within reserve"
        : ", over even with reserve"
      : "";
  return (
    <p className="mt-2 flex flex-wrap items-baseline gap-x-1.5 text-xs">
      <Verdict bar={bar} fmt={fmt} variant={variant} />
      {projected !== null && (
        <span
          className={cn(
            "num tabular-nums",
            pacingTone(pct) === "warn" ? "text-warn" : "text-ink-3",
          )}
        >
          · projected {fmt(projected)}
          {pct !== null && ` (${signedPct(pct, 0)} ${vsLabel}${reserveNote})`}
        </span>
      )}
    </p>
  );
}

/** "by 2026-09-05 (the last day of data)" — the bar's aria anchor, in the Tracker's words. */
export function anchorWords(through: string | null): string {
  return through ? `by ${through} (the last day of data)` : "— no data yet";
}
