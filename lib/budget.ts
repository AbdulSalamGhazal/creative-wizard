/**
 * Pure math + month helpers for the Budget module. Standing decisions this
 * module encodes (do not "fix"):
 * - Spend is planned/actualized in USD; revenue is SAR only. The two currencies
 *   meet ONLY through the per-brand USD→SAR rate (ROAS-through-rate below).
 * - Pacing deviation is a MAGNITUDE (over- and under-pace are both deviations)
 *   — warn-tinted, never green/red good/bad. Same philosophy as Reconciliation.
 */

import { signedPct } from "@/lib/format";
import { ALL_PLATFORMS } from "@/lib/palette";

/** "2026-09" → "2026-09-01"; passes through a full ISO date's month. */
export function monthStartIso(month: string): string {
  const m = month.match(/^(\d{4})-(\d{2})/);
  if (!m) return month;
  return `${m[1]}-${m[2]}-01`;
}

/** The YYYY-MM key of an ISO date. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** Days in the month containing `monthIso` (first-of-month ISO). */
export function daysInMonth(monthIso: string): number {
  const [y, m] = monthIso.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

/** The last day of the month a YYYY-MM key names ("2026-09" → "2026-09-30"). */
export function monthEndIso(month: string): string {
  const start = monthStartIso(month);
  return `${start.slice(0, 8)}${String(daysInMonth(start)).padStart(2, "0")}`;
}

/** Previous / next month keys ("2026-09" → "2026-08" / "2026-10"). */
export function prevMonthKey(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 2, 1));
  return d.toISOString().slice(0, 7);
}
export function nextMonthKey(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m!, 1));
  return d.toISOString().slice(0, 7);
}

/** "September 2026" (en-US, matching the app's pinned locale). */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Elapsed days of `month` as of `todayIso`, clamped to [0, daysInMonth].
 * Day 1 counts as 1 elapsed day.
 *
 * This is the CALENDAR position — "Day 12 of 30", "planned for today" — and
 * that is all it is for. **Pacing COMPARISONS no longer anchor here**: they
 * anchor to DATA COVERAGE (`coverageDayInMonth`), because actuals end at the
 * last upload while the calendar does not, and comparing the two makes every
 * platform look a day behind. See the coverage block below.
 */
export function elapsedDaysInMonth(month: string, todayIso: string): number {
  const total = daysInMonth(monthStartIso(month));
  if (monthKey(todayIso) < month) return 0; // future month
  if (monthKey(todayIso) > month) return total; // past month
  return Math.min(total, Number(todayIso.slice(8, 10)));
}

/**
 * Pacing deviation = (actual − expected) / expected. NULL when there's nothing
 * expected yet (no plan, or day 0) — the UI renders "—" instead of a verdict.
 */
export function pacingDeviation(
  actual: number,
  expected: number,
): number | null {
  if (expected <= 0) return null;
  const deviation = (actual - expected) / expected;
  return Number.isFinite(deviation) ? deviation : null;
}

/** |deviation| at/above this is a "large" pacing miss → strong warn tint. */
export const PACING_WARN_THRESHOLD = 0.15;

export type PacingDirection = "ahead" | "behind" | "muted";
export type PacingStrength = "strong" | "faint";

/**
 * How a pacing deviation is COLOURED (2026-10-19, user decision — see
 * docs/decisions/budget.md): the DIRECTION picks the colour (ahead blue,
 * behind amber, muted for no verdict), the magnitude threshold picks only the
 * STRENGTH of the tint. Never green/red: over- and under-pace are both
 * deviations, and the colour says which way, not whether it is good.
 */
export interface PacingTone {
  direction: PacingDirection;
  /** |deviation| ≥ PACING_WARN_THRESHOLD → "strong"; inside it → "faint". */
  strength: PacingStrength;
}

/** No verdict — nothing expected yet, or exactly on the curve. */
export const MUTED_TONE: PacingTone = { direction: "muted", strength: "faint" };

/**
 * A non-finite deviation (dividing by a zero plan) is NOT a big miss, it is
 * no verdict at all: it must never light up.
 */
export function pacingTone(deviation: number | null): PacingTone {
  if (deviation === null || !Number.isFinite(deviation) || deviation === 0) return MUTED_TONE;
  return {
    direction: deviation > 0 ? "ahead" : "behind",
    strength: Math.abs(deviation) >= PACING_WARN_THRESHOLD ? "strong" : "faint",
  };
}

/**
 * The shown percentage rounds to 0% — judged exactly as `signedPct` prints
 * it, so a cell and a verdict can never disagree about a zero.
 */
export function pctReadsZero(deviation: number | null): boolean {
  return deviation !== null && Number.isFinite(deviation) && signedPct(deviation, 0) === "0%";
}

/**
 * A pace verdict reads "on track" when what is SHOWN says so: the delta
 * rounds to zero whole dollars, or the percentage rounds to 0% (2026-10-19 —
 * a −$5 miss on a $9,000 plan is not a verdict, it is noise).
 */
export function paceReadsOnTrack(bar: Pick<TrackerBar, "delta" | "deviation">): boolean {
  return Math.round(bar.delta) === 0 || pctReadsZero(bar.deviation);
}

/** The tone the tint reads as "strong" — past the magnitude threshold. */
export function isStrongTone(tone: PacingTone): boolean {
  return tone.direction !== "muted" && tone.strength === "strong";
}

/** "on track" / "12% ahead" / "8% behind" (rounded, magnitude-worded). */
export function pacingVerdict(deviation: number | null): string {
  // Non-finite reads as "—" too — "Infinity% ahead" is not a verdict.
  if (deviation === null || !Number.isFinite(deviation)) return "—";
  const pct = Math.round(Math.abs(deviation) * 100);
  if (pct === 0) return "on track";
  return `${pct}% ${deviation > 0 ? "ahead" : "behind"}`;
}

// ── Data coverage: what a pacing comparison is allowed to anchor to ─────────
// STANDING DECISION (2026-10, user-reported bug): Budget pacing COMPARISONS
// anchor to DATA COVERAGE, per platform — never to the calendar. "Planned so
// far" means "planned through the days this platform's data actually covers".
//
// The bug it fixes: the tick, the deviations and the projection counted TODAY
// as fully elapsed while actuals stopped at the last upload, so a brand that
// spent exactly to plan read as ~a day behind every morning — and worse the
// longer an upload lagged. Nothing about the plan changed; the yardstick was
// measuring days nobody had reported yet.

/** Latest UPLOADED day per platform (ISO), as `platformHorizons()` returns it. */
export type PlatformCoverage = Readonly<Record<string, string | null | undefined>>;

/**
 * How many days of `month` one platform's data COVERS, clamped to
 * [0, daysInMonth] — the day a pacing comparison may count through.
 *
 * Deliberately NOT the status system's freshness: that one needs spend > 0,
 * because it answers "is this still running". A $0 day is still a reported
 * day, so it covers.
 *
 *  · no data at all, or data that stops before this month → 0. Nothing is
 *    expected yet, so the row's deviation is null — never "100% behind".
 *  · a PAST month → the whole month. It is over, the comparison is final, and
 *    this keeps every historical number identical to what it was.
 *  · a FUTURE month → 0, as before.
 */
export function coverageDayInMonth(
  month: string,
  coverageIso: string | null | undefined,
  todayIso: string,
): number {
  const total = daysInMonth(monthStartIso(month));
  const todayMonth = monthKey(todayIso);
  if (todayMonth > month) return total; // past month: final, clamp to full
  if (todayMonth < month) return 0; // future month: nothing expected
  if (!coverageIso) return 0; // current month, no data for this platform
  const coverageMonth = monthKey(coverageIso);
  if (coverageMonth < month) return 0; // data stops before this month
  if (coverageMonth > month) return total; // data runs past it (clock skew)
  return Math.min(total, Math.max(0, Number(coverageIso.slice(8, 10))));
}

/**
 * The anchor, as a function of platform: how many days of `month` this
 * platform's comparison may count through. Built once per render and shared by
 * every pacing surface (Tracker — both views — and Overview) so the rule
 * lives in ONE place. No coverage read → the calendar, i.e. the old behaviour.
 */
export function makeCoverageDay(
  month: string,
  todayIso: string,
  coverage?: PlatformCoverage,
): (platform: string) => number {
  if (coverage === undefined) {
    const elapsed = elapsedDaysInMonth(month, todayIso);
    return () => elapsed;
  }
  return (platform: string) =>
    coverageDayInMonth(month, coverage[platform], todayIso);
}

/** The latest day ANY platform covers — the "data through" the pages print. */
export function latestCoverage(coverage: PlatformCoverage): string | null {
  return Object.values(coverage).reduce<string | null>(
    (a, d) => (d ? (a === null || d > a ? d : a) : a),
    null,
  );
}

export interface CoverageSummary {
  /** The latest day ANY of these platforms covers — the header's "data through". */
  through: string | null;
  /** Platforms whose coverage trails `through` by more than a day, worst first. */
  laggards: Array<{ platform: string; date: string | null }>;
}

/**
 * What the header says about coverage: the overall "data through" day, and the
 * platforms that trail it by MORE THAN ONE DAY — a one-day spread is the
 * normal shape of an upload morning and naming it would be noise.
 */
export function coverageSummary(
  coverage: PlatformCoverage,
  platforms: readonly string[],
): CoverageSummary {
  const dates = platforms.map((p) => coverage[p] ?? null);
  const through = dates.reduce<string | null>(
    (a, d) => (d !== null && (a === null || d > a) ? d : a),
    null,
  );
  if (through === null) return { through: null, laggards: [] };
  const laggards = platforms
    .map((platform) => ({ platform, date: coverage[platform] ?? null }))
    // `isoDaysBetween` is inclusive of both ends, so a one-day gap has 2 days
    // in it; anything longer than that is a real lag worth naming.
    .filter((p) => p.date === null || isoDaysBetween(p.date, through).length > 2)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  return { through, laggards };
}

/** Variance = actual − planned (same currency as the inputs). */
export function variance(actual: number, planned: number): number {
  return actual - planned;
}

/** Variance % of plan; NULL when there is no plan (renders "—"). */
export function variancePct(actual: number, planned: number): number | null {
  if (planned === 0) return null;
  return (actual - planned) / planned;
}

/**
 * ROAS through the brand rate: revenue (SAR) ÷ (spend USD × rate). NULL when
 * spend is zero or the rate is unusable — the UI shows "—" plus a hint.
 * Computed through the rate REGARDLESS of the display-currency toggle.
 */
export function roasThroughRate(
  revenueSar: number,
  spendUsd: number,
  rate: number,
): number | null {
  if (spendUsd <= 0 || rate <= 0) return null;
  return revenueSar / (spendUsd * rate);
}

/** The rate must be a real positive number, capped at 100 (fat-finger guard). */
export function validateRate(rate: number): boolean {
  return Number.isFinite(rate) && rate > 0 && rate <= 100;
}

/** Spend display conversion: USD natively, or ×rate when the toggle says SAR. */
export function spendInDisplayCurrency(
  usd: number,
  currency: "USD" | "SAR",
  rate: number,
): number {
  return currency === "SAR" ? usd * rate : usd;
}

// ── Day-weight plan curve (v2) ───────────────────────────────────────────────
// Only OVERRIDDEN days are stored (absent day = weight 1), so a month with no
// overrides normalizes to exactly the linear v1 curve. ONE curve drives both
// spend and revenue pacing/projection (user decision). The reserve budget is
// deliberately OUTSIDE the curve — it is part of the total, held back rather
// than scheduled, so only the ALLOCATED plan is paced.

/** A day weight must be a positive number, at most 10. */
export function validateWeight(weight: number): boolean {
  return Number.isFinite(weight) && weight > 0 && weight <= 10;
}

/** Per-day weight array (index 0 = day 1) for the month; absent day → 1. */
export function dayWeights(
  monthIso: string,
  overrides: Record<number, number>,
): number[] {
  const total = daysInMonth(monthStartIso(monthIso));
  return Array.from({ length: total }, (_, i) => {
    const w = overrides[i + 1];
    return w !== undefined && validateWeight(w) ? w : 1;
  });
}

/**
 * Fraction of the month's curve elapsed through `throughDay` (inclusive):
 * Σweights(1..day) ÷ Σweights(all). Clamped; 0 when throughDay < 1. With no
 * overrides this is exactly day ÷ daysInMonth — v1's linear pacing.
 */
export function curveFraction(
  monthIso: string,
  overrides: Record<number, number>,
  throughDay: number,
): number {
  const weights = dayWeights(monthIso, overrides);
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return 0;
  const upTo = Math.max(0, Math.min(weights.length, Math.floor(throughDay)));
  const partial = weights.slice(0, upTo).reduce((s, w) => s + w, 0);
  return partial / total;
}

/** Plan-to-date through the curve — the module's one pacing baseline. */
export function curveExpected(
  planned: number,
  monthIso: string,
  overrides: Record<number, number>,
  throughDay: number,
): number {
  return planned * curveFraction(monthIso, overrides, throughDay);
}

/**
 * Curve-aware month-end projection: actual-to-date ÷ elapsed curve fraction.
 * NULL when the fraction is 0 (e.g. day-1 edge with a zero-weight start) —
 * the UI renders "—" instead of dividing by zero.
 */
export function projectedMonthEnd(
  actualToDate: number,
  monthIso: string,
  overrides: Record<number, number>,
  throughDay: number,
): number | null {
  const fraction = curveFraction(monthIso, overrides, throughDay);
  if (fraction <= 0) return null;
  return actualToDate / fraction;
}

/**
 * Map a month's weight overrides onto another month for Copy-from-last-month:
 * day numbers carry over; days past the target month's length (e.g. day 31 →
 * a 30-day month) are dropped.
 */
export function mapWeightsToMonth(
  overrides: Record<number, number>,
  targetMonthIso: string,
): Record<number, number> {
  const limit = daysInMonth(monthStartIso(targetMonthIso));
  const out: Record<number, number> = {};
  for (const [dayStr, weight] of Object.entries(overrides)) {
    const day = Number(dayStr);
    if (day >= 1 && day <= limit) out[day] = weight;
  }
  return out;
}

// ── Percentage-based distribution (Plan editor, 2026-09) ─────────────────────
// AMOUNTS ARE THE STORED TRUTH — percentages exist only as an editing
// affordance, computed live from the drafts and never persisted. Everything
// here works in integer cents internally so a split's parts sum EXACTLY to the
// total the user typed; a plain `total * pct` per row drifts by a cent or two
// and the "Unallocated" chip would then never reach zero.

/** Round money to 2dp, guarding the usual binary-fraction near-misses. */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + (value >= 0 ? 1e-9 : -1e-9)) * 100) / 100;
}

/** A row's share of a total, as a percentage. NULL when there is no total. */
export function pctShare(amount: number, total: number): number | null {
  if (total <= 0) return null;
  return (amount / total) * 100;
}

/**
 * Split `total` across `weights` so every part is 2dp and the parts sum to
 * `total` EXACTLY (largest-remainder: the leftover cents go to the parts with
 * the biggest truncated fractions, ties by position). All-zero weights split
 * evenly — the caller's "distribute remaining" over untouched rows.
 */
export function splitByWeights(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const cents = Math.round(round2(total) * 100);
  if (cents <= 0) return weights.map(() => 0);
  const positive = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const sum = positive.reduce((s, w) => s + w, 0);
  const shares = sum > 0 ? positive.map((w) => w / sum) : positive.map(() => 1 / n);
  const raw = shares.map((s) => s * cents);
  const out = raw.map((r) => Math.floor(r));
  let left = cents - out.reduce((s, c) => s + c, 0);
  const byRemainder = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < byRemainder.length && left > 0; k++, left--) {
    out[byRemainder[k]!.i] = out[byRemainder[k]!.i]! + 1;
  }
  return out.map((c) => c / 100);
}


/**
 * Add `remaining` to the rows in equal parts (exact to the cent). A negative
 * remainder is clamped per row at zero, which is the one case where the parts
 * no longer sum to `remaining` — the UI only offers this when there is a real
 * positive remainder to place.
 */
export function distributeRemainder(amounts: number[], remaining: number): number[] {
  if (amounts.length === 0) return amounts;
  if (remaining >= 0) {
    const parts = splitByWeights(remaining, amounts.map(() => 0));
    return amounts.map((a, i) => round2(a + parts[i]!));
  }
  const parts = splitByWeights(-remaining, amounts.map(() => 0));
  return amounts.map((a, i) => Math.max(0, round2(a - parts[i]!)));
}


// ── Budget objective buckets ─────────────────────────────────────────────────
// The Budget module plans against its OWN objective axis, coarser than the
// campaign vocabulary: the three the team actually budgets for, plus a
// catch-all. Campaign objectives elsewhere in the system are untouched — this
// is a budget-local lens applied to them, so a future campaign-objective
// rename only has to teach `toBudgetObjective` about the new value; it can
// never strand a `budget_allocations` row again.

export const BUDGET_OBJECTIVES = [
  "Awareness",
  "Activation",
  "Retargeting",
  "Other",
] as const;

export type BudgetObjective = (typeof BUDGET_OBJECTIVES)[number];

/**
 * How a month is planned — ONE mode at a time (2026-09, user-approved v1):
 * - `curve`: monthly allocations per platform × bucket, spread across the days
 *   by the shared day-weight curve. The editor, Move money and the calendar.
 * - `daily`: explicit day-grain cells per platform × bucket, landed ONLY by the
 *   sheet upload; the monthly allocations become their derived SUMS.
 * App-side enum over `budget_targets.plan_mode` (varchar); absent row = curve.
 */
export const PLAN_MODES = ["curve", "daily"] as const;
export type PlanMode = (typeof PLAN_MODES)[number];

/** The three that map one-to-one; everything else falls into "Other". */
const BUDGET_MAIN: ReadonlySet<string> = new Set(
  BUDGET_OBJECTIVES.filter((o) => o !== "Other"),
);

/**
 * A campaign objective seen through the budget lens. Sales, Prospecting,
 * Special Case — and any objective added later — land in "Other" rather than
 * inventing a bucket nobody plans against.
 */
export function toBudgetObjective(objective: string): BudgetObjective {
  return BUDGET_MAIN.has(objective) ? (objective as BudgetObjective) : "Other";
}

/** Sort key so bucketed output is deterministic wherever it is built. */
export function budgetObjectiveOrder(objective: BudgetObjective): number {
  return BUDGET_OBJECTIVES.indexOf(objective);
}

export interface BucketedAllocation {
  platform: string;
  objective: BudgetObjective;
  plannedSpend: number;
}

/**
 * Fold allocations onto the budget buckets, SUMMING rows that collapse
 * together — two rows on the same platform (say Sales and Prospecting) become
 * one "Other" row carrying both. Used by the 0041 migration's logic, and by
 * restore, so a snapshot written under the old vocabulary comes back as a
 * valid plan instead of failing validation.
 */
export function mergeAllocationsToBuckets(
  rows: Array<{ platform: string; objective: string; plannedSpend: number }>,
): BucketedAllocation[] {
  const merged = new Map<string, BucketedAllocation>();
  for (const row of rows) {
    const objective = toBudgetObjective(row.objective);
    const key = budgetComboKey(row.platform, objective);
    const existing = merged.get(key);
    if (existing) existing.plannedSpend = round2(existing.plannedSpend + row.plannedSpend);
    else merged.set(key, { platform: row.platform, objective, plannedSpend: row.plannedSpend });
  }
  return [...merged.values()].sort(
    (a, b) =>
      (a.platform < b.platform ? -1 : a.platform > b.platform ? 1 : 0) ||
      budgetObjectiveOrder(a.objective) - budgetObjectiveOrder(b.objective),
  );
}

// ── Bucketing over an arbitrary date range (Pacing) ──────────────────────────

export interface RangeBucket {
  /** Stable key + sort order: the bucket's first ISO date. */
  key: string;
  /** Axis/table label — "Sep 1", "Sep 1–6", "Sep 2026". */
  label: string;
  /** Inclusive ISO bounds, always clipped INSIDE the requested range. */
  start: string;
  end: string;
}

function shortMonth(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
}

function dayLabel(iso: string): string {
  return `${shortMonth(iso)} ${Number(iso.slice(8, 10))}`;
}

/** One bucket per day of the range. */
export function dayBucketsInRange(from: string, to: string): RangeBucket[] {
  const out: RangeBucket[] = [];
  for (let iso = from; iso <= to; iso = isoPlusDays(iso, 1)) {
    out.push({ key: iso, label: dayLabel(iso), start: iso, end: iso });
  }
  return out;
}

/**
 * Calendar weeks, SUNDAY-start (matching the Plan page's day-curve calendar),
 * CLIPPED to the range: the first and last buckets are partial whenever the
 * range doesn't begin or end on a week boundary. A bucket never reaches outside
 * the range the user asked for.
 */
export function weekBucketsInRange(from: string, to: string): RangeBucket[] {
  const out: RangeBucket[] = [];
  let start = from;
  while (start <= to) {
    const weekday = new Date(`${start}T00:00:00Z`).getUTCDay(); // 0 = Sunday
    const weekEnd = isoPlusDays(start, 6 - weekday);
    const end = weekEnd > to ? to : weekEnd;
    out.push({
      key: start,
      label:
        start === end
          ? dayLabel(start)
          : shortMonth(start) === shortMonth(end)
            ? `${shortMonth(start)} ${Number(start.slice(8, 10))}–${Number(end.slice(8, 10))}`
            : `${dayLabel(start)}–${dayLabel(end)}`,
      start,
      end,
    });
    start = isoPlusDays(end, 1);
  }
  return out;
}

/** Calendar months, clipped to the range (first/last may be partial). */
export function monthBucketsInRange(from: string, to: string): RangeBucket[] {
  const out: RangeBucket[] = [];
  let start = from;
  while (start <= to) {
    const monthEnd = `${start.slice(0, 8)}${String(daysInMonth(monthStartIso(start))).padStart(2, "0")}`;
    const end = monthEnd > to ? to : monthEnd;
    out.push({
      key: start,
      label: `${shortMonth(start)} ${start.slice(0, 4)}`,
      start,
      end,
    });
    start = isoPlusDays(end, 1);
  }
  return out;
}

// ── Plan stitched across months ──────────────────────────────────────────────

/**
 * A month's per-day planned amounts (index 0 = day 1), from the day-weight
 * curve: day d gets `planned × (curveFraction(d) − curveFraction(d−1))`. The
 * increments sum back to `planned` because the curve fractions are a partition
 * of 1 — that property is what lets an arbitrary date range be compared
 * against a plan that is only ever stored per month.
 */
export function monthDayIncrements(
  monthIso: string,
  overrides: Record<number, number>,
  planned: number,
): number[] {
  const weights = dayWeights(monthIso, overrides);
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return weights.map(() => 0);
  return weights.map((w) => (planned * w) / total);
}

// ── The unified plan series (2026-09) ────────────────────────────────────────
// THE load-bearing abstraction for plan-to-date. A month is planned in one of
// two modes (`PLAN_MODES`), and every consumer of "what should have happened by
// day d" — Tracker (both groupings), Pacing, Overview's cards, chart and pace
// board, and any future alert evaluator — reads it through `buildPlanSeries`,
// never by expanding a curve itself. Curve months reproduce the pre-modes math
// bit for bit (pinned); daily months read their cells verbatim.

/** One day-grain plan cell (daily mode): USD planned for a day × combo. */
export interface PlanDayCell {
  day: number;
  platform: string;
  objective: string;
  plannedSpend: number;
}

/** Everything a month's series is built from — structural, so both
 *  `getBudgetMonth()` (via `planSeriesSourceOf`) and `budgetPlansForMonths()`
 *  rows satisfy it without this module importing the DB layer. */
export interface PlanSeriesSource {
  /** YYYY-MM (or any ISO date inside the month). */
  month: string;
  planMode: PlanMode;
  allocations: ReadonlyArray<{ platform: string; objective: string; plannedSpend: number }>;
  plannedRevenueSar: number | null;
  /** Curve mode's day weights (dormant — ignored — in daily mode). */
  dayWeights: Record<number, number>;
  /** Daily mode's cells (empty in curve mode). */
  planDays: ReadonlyArray<PlanDayCell>;
  /** Daily mode's revenue link (see `revenueFromRoas`); null = no target. */
  targetRoas: number | null;
  usdToSarRate: number;
}

/** Which platform × bucket combos a slice covers. */
export type ComboMatch = (platform: string, objective: string) => boolean;
export const EVERY_COMBO: ComboMatch = () => true;

export interface PlanSeries {
  month: string;
  mode: PlanMode;
  totalDays: number;
  /**
   * The month's pacing SHAPE: the share of the whole plan expected by the end
   * of `throughDay`. Curve: the curve fraction. Daily: planned spend to date ÷
   * the month's planned spend (linear when nothing is planned, so a daily
   * month with no money still has a calendar).
   */
  fraction(throughDay: number): number;
  /**
   * Plan-to-date for a slice. `plan` is the slice's full-month plan as the
   * caller already summed it — a curve month scales it by the shared curve
   * (exactly `curveExpected`); a daily month ignores it and sums the slice's
   * own cells, which equal `plan` over the whole month by the
   * allocations-are-derived-sums invariant.
   */
  spendToDate(plan: number, throughDay: number, match?: ComboMatch): number;
  /** Planned spend per day (index 0 = day 1) for a slice. */
  spendDays(match?: ComboMatch): number[];
  /** The month's revenue target, SAR — daily mode derives it from the ROAS. */
  plannedRevenueSar: number | null;
  revenueToDate(throughDay: number): number;
  /** Planned revenue per day; null without a target. */
  revenueDays(): number[] | null;
  /** actual ÷ elapsed fraction; null when nothing is expected yet. */
  projectedMonthEnd(actualToDate: number, throughDay: number): number | null;
}

/**
 * Daily mode's revenue link, in the brand's ROAS convention
 * (`roasThroughRate`: SAR revenue ÷ (USD spend × rate)): revenue SAR = spend
 * USD × ROAS × rate. Rounded to the cent — it is a target someone reads.
 */
export function revenueFromRoas(roas: number, spendUsd: number, rate: number): number {
  return round2(roas * spendUsd * rate);
}

/** The inverse, for the dual-entry field — exactly `roasThroughRate`. */
export function roasFromRevenue(
  revenueSar: number,
  spendUsd: number,
  rate: number,
): number | null {
  return roasThroughRate(revenueSar, spendUsd, rate);
}

/**
 * The monthly allocations a daily month's cells imply — the SUMS, per
 * platform × bucket, rounded to the cent, zero combos dropped, in
 * `ALL_PLATFORMS` × `BUDGET_OBJECTIVES` order. The one plan writer stores
 * exactly this whenever it writes a daily month, which is what keeps every
 * monthly-total consumer (copy, revision summaries, Overview's cards) working
 * without knowing modes exist.
 */
export function allocationsFromDays(
  days: ReadonlyArray<PlanDayCell>,
): Array<{ platform: string; objective: BudgetObjective; plannedSpend: number }> {
  const sums = new Map<string, number>();
  for (const c of days) {
    const key = budgetComboKey(c.platform, c.objective);
    sums.set(key, (sums.get(key) ?? 0) + c.plannedSpend);
  }
  const out: Array<{ platform: string; objective: BudgetObjective; plannedSpend: number }> = [];
  for (const platform of ALL_PLATFORMS) {
    for (const objective of BUDGET_OBJECTIVES) {
      const sum = round2(sums.get(budgetComboKey(platform, objective)) ?? 0);
      if (sum > 0) out.push({ platform, objective, plannedSpend: sum });
    }
  }
  return out;
}

const prefixSum = (values: readonly number[], throughDay: number): number => {
  const upTo = Math.max(0, Math.min(values.length, Math.floor(throughDay)));
  let sum = 0;
  for (let i = 0; i < upTo; i++) sum += values[i]!;
  return sum;
};

export function buildPlanSeries(src: PlanSeriesSource): PlanSeries {
  const monthIso = monthStartIso(src.month);
  const totalDays = daysInMonth(monthIso);
  const month = monthIso.slice(0, 7);

  if (src.planMode === "daily") {
    const cells = src.planDays.filter((c) => c.day >= 1 && c.day <= totalDays);
    const spendDays = (match: ComboMatch = EVERY_COMBO) => {
      const out = new Array<number>(totalDays).fill(0);
      for (const c of cells) if (match(c.platform, c.objective)) out[c.day - 1]! += c.plannedSpend;
      return out;
    };
    const all = spendDays();
    const monthTotal = all.reduce((s, v) => s + v, 0);
    const fraction = (throughDay: number) => {
      const d = Math.max(0, Math.min(totalDays, Math.floor(throughDay)));
      return monthTotal > 0 ? prefixSum(all, d) / monthTotal : d / totalDays;
    };
    const roas = src.targetRoas;
    const revenue =
      roas !== null && roas > 0 ? all.map((v) => v * roas * src.usdToSarRate) : null;
    return {
      month,
      mode: "daily",
      totalDays,
      fraction,
      spendToDate: (_plan, throughDay, match = EVERY_COMBO) =>
        prefixSum(spendDays(match), throughDay),
      spendDays,
      plannedRevenueSar:
        revenue === null ? null : revenueFromRoas(roas!, monthTotal, src.usdToSarRate),
      revenueToDate: (throughDay) => (revenue === null ? 0 : prefixSum(revenue, throughDay)),
      revenueDays: () => (revenue === null ? null : [...revenue]),
      projectedMonthEnd: (actualToDate, throughDay) => {
        const f = fraction(throughDay);
        return f > 0 ? actualToDate / f : null;
      },
    };
  }

  // Curve mode — TODAY'S MATH, UNCHANGED: these delegate to the same
  // functions every page called before the series existed.
  const weights = src.dayWeights;
  const target = src.plannedRevenueSar;
  return {
    month,
    mode: "curve",
    totalDays,
    fraction: (throughDay) => curveFraction(monthIso, weights, throughDay),
    spendToDate: (plan, throughDay) => curveExpected(plan, monthIso, weights, throughDay),
    spendDays: (match = EVERY_COMBO) =>
      monthDayIncrements(
        monthIso,
        weights,
        src.allocations
          .filter((a) => match(a.platform, a.objective))
          .reduce((s, a) => s + a.plannedSpend, 0),
      ),
    plannedRevenueSar: target,
    revenueToDate: (throughDay) =>
      target === null ? 0 : curveExpected(target, monthIso, weights, throughDay),
    revenueDays: () =>
      target === null ? null : monthDayIncrements(monthIso, weights, target),
    projectedMonthEnd: (actualToDate, throughDay) =>
      projectedMonthEnd(actualToDate, monthIso, weights, throughDay),
  };
}

/**
 * The series source for a month as `getBudgetMonth()` returns it (its weights
 * field is `dayWeightOverrides`). Structural input, so this stays DB-free.
 */
export function planSeriesSourceOf(
  data: {
    allocations: ReadonlyArray<{ platform: string; objective: string; plannedSpend: number }>;
    plannedRevenueSar: number | null;
    dayWeightOverrides: Record<number, number>;
    planMode: PlanMode;
    planDays: ReadonlyArray<PlanDayCell>;
    targetRoas: number | null;
    usdToSarRate: number;
  },
  month: string,
): PlanSeriesSource {
  return {
    month,
    planMode: data.planMode,
    allocations: data.allocations,
    plannedRevenueSar: data.plannedRevenueSar,
    dayWeights: data.dayWeightOverrides,
    planDays: data.planDays,
    targetRoas: data.targetRoas,
    usdToSarRate: data.usdToSarRate,
  };
}

/**
 * Planned amounts per ISO date across every month a range touches, from each
 * month's SERIES — so a range spanning a curve month and a daily month
 * stitches both honestly. `pick` returning null means "no plan" (the month
 * contributes nothing), which the caller distinguishes from a planned zero.
 */
export function stitchPlanByDay(
  series: readonly PlanSeries[],
  pick: (s: PlanSeries) => number[] | null,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of series) {
    const days = pick(s);
    if (days === null) continue;
    const prefix = monthStartIso(s.month).slice(0, 8);
    days.forEach((value, i) => {
      out.set(`${prefix}${String(i + 1).padStart(2, "0")}`, value);
    });
  }
  return out;
}

/** Every YYYY-MM a range touches, ascending. */
export function monthsInRange(from: string, to: string): string[] {
  const out: string[] = [];
  let month = from.slice(0, 7);
  const last = to.slice(0, 7);
  while (month <= last) {
    out.push(month);
    month = nextMonthKey(month);
  }
  return out;
}

// ── Top-down planning cascade (Plan editor, 2026-09) ─────────────────────────
// The editor works top-down: a total spend budget, a reserve carved OUT of it,
// then percentage shares down two levels — platform share of the allocatable,
// objective share of its platform. SHARES are the primary state; amounts are
// derived cents-exactly from them (`splitByWeights`), which is what makes
// "change the total" a pure rescale and what keeps a 33.3/33.3/33.4 split
// summing to exactly the parent instead of a cent short.

/** How close a set of shares must come to 100% — float dust only, not slack. */
export const SHARE_EPSILON = 0.005;

/**
 * What's actually allocatable: the total minus the reserve. The reserve is
 * PART of the total, held back to decide later — not money on top of it.
 */
export function allocatableFromTotal(total: number, reserve: number): number {
  return round2(Math.max(0, total - reserve));
}

/** The reserve as a share of the total (dual entry). NULL with no total. */
export function reserveShare(reserve: number, total: number): number | null {
  if (total <= 0) return null;
  return (reserve / total) * 100;
}

/** The reserve amount a share of the total implies, clamped into the total. */
export function reserveFromShare(share: number, total: number): number {
  if (!Number.isFinite(share) || total <= 0) return 0;
  return round2((total * Math.min(100, Math.max(0, share))) / 100);
}

/**
 * The amounts a set of shares implies over a parent total.
 *
 * Each row gets literally its own percentage of the parent — deliberately NOT
 * `splitByWeights`, which normalises the weights and would hand the whole
 * budget to a platform typed at 50% before its siblings exist. Mid-edit, 80%
 * assigned places 80% of the money and the rest is visibly unassigned, which is
 * what the 100%-or-no-save rule is there to surface. Rounding is still settled
 * by largest remainder, so once the shares DO reach 100% the parts sum to the
 * parent exactly.
 */
export function amountsFromShares(parentTotal: number, shares: number[]): number[] {
  const totalCents = Math.round(round2(parentTotal) * 100);
  if (shares.length === 0) return [];
  if (totalCents <= 0) return shares.map(() => 0);
  const raw = shares.map((s) => {
    const share = Number.isFinite(s) ? Math.max(0, s) : 0;
    return (totalCents * share) / 100;
  });
  const target = Math.round(raw.reduce((sum, v) => sum + v, 0));
  const out = raw.map((v) => Math.floor(v));
  let left = target - out.reduce((sum, c) => sum + c, 0);
  const byRemainder = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < byRemainder.length && left > 0; k++, left--) {
    out[byRemainder[k]!.i] = out[byRemainder[k]!.i]! + 1;
  }
  return out.map((c) => c / 100);
}

/**
 * The share an amount represents of its parent — the back-computation when
 * someone types a dollar figure instead of a percentage. Full precision on
 * purpose: rounding here to the displayed 1dp would move the OTHER rows'
 * money, which is exactly what a secondary input must not do.
 */
export function shareFromAmount(amount: number, parentTotal: number): number {
  if (parentTotal <= 0) return 0;
  return (amount / parentTotal) * 100;
}

/** How much share is still unassigned (negative = over-assigned). */
export function shareRemainder(shares: number[]): number {
  return round2(100 - shares.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0));
}

/** Do these shares add up to 100%? Tolerant of float dust, nothing more. */
export function sharesComplete(shares: number[]): boolean {
  if (shares.length === 0) return false;
  return Math.abs(shareRemainder(shares)) < SHARE_EPSILON;
}

/**
 * Spread whatever share is unassigned evenly across the rows, landing on
 * exactly 100%. The one-click fix for the editor's blocked-save state.
 */
export function distributeShareEvenly(shares: number[]): number[] {
  if (shares.length === 0) return shares;
  return distributeRemainder(shares, shareRemainder(shares));
}

/** Where money being moved comes from. */
export type MoneySource =
  | { kind: "reserve" }
  | { kind: "platform"; index: number }
  /** Not a move at all — the total grows by the amount. */
  | { kind: "new" };

export interface MoneyMove {
  /** Per-platform amounts after the move. */
  amounts: number[];
  /** What's left in the reserve. */
  reserve: number;
  /** The new total budget (only "new money" changes it). */
  total: number;
  /** The new allocatable — total − reserve. */
  allocatable: number;
  /** Shares of the NEW allocatable — full precision, so no row drifts a cent. */
  shares: number[];
}

/**
 * Move money into ONE platform, from the reserve, from another platform, or
 * from outside the budget entirely ("new money", which grows the total).
 *
 * This is a transfer, not a re-plan. The target's dollars rise by exactly the
 * amount and the source's fall by exactly the amount; every other platform
 * keeps its dollars to the cent, and only their displayed percentages move
 * because the allocatable shifted beneath them. Inside the target, objective
 * shares are untouched, so the new money spreads proportionally.
 *
 * `allocatable` is the CURRENT allocatable (total − reserve), which the caller
 * already knows — it is NOT Σ`amounts`. Those two are equal only once a plan
 * is fully assigned, and deriving shares from the wrong one silently inflates
 * every amount mid-edit (the bug fixed in the correctness pass; never go back
 * to the share domain). Returns null when the move isn't possible.
 */
export function moveMoney(input: {
  amounts: number[];
  /** Index of the platform receiving the money. */
  toIndex: number;
  amount: number;
  source: MoneySource;
  reserve: number;
  total: number;
  allocatable: number;
}): MoneyMove | null {
  const { amounts, toIndex, amount, source, reserve, total, allocatable } = input;
  if (toIndex < 0 || toIndex >= amounts.length) return null;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const moved = round2(amount);

  if (source.kind === "platform") {
    if (source.index < 0 || source.index >= amounts.length) return null;
    if (source.index === toIndex) return null; // moving to itself is a no-op
    if (moved > round2(amounts[source.index]!)) return null;
  } else if (source.kind === "reserve") {
    if (moved > round2(reserve)) return null;
  }

  const nextAmounts = amounts.map((a, i) => {
    if (i === toIndex) return round2(a + moved);
    if (source.kind === "platform" && i === source.index) return round2(a - moved);
    return a;
  });

  // Only the reserve source shrinks the reserve; only new money grows the
  // total. A platform-to-platform move changes neither.
  const nextReserve = source.kind === "reserve" ? round2(reserve - moved) : round2(reserve);
  const nextTotal = source.kind === "new" ? round2(total + moved) : round2(total);
  const nextAllocatable =
    source.kind === "platform" ? round2(allocatable) : round2(allocatable + moved);

  return {
    amounts: nextAmounts,
    reserve: nextReserve,
    total: nextTotal,
    allocatable: nextAllocatable,
    shares: nextAmounts.map((a) => shareFromAmount(a, nextAllocatable)),
  };
}

/**
 * Scale a set of shares so they sum to exactly 100%, keeping their PROPORTIONS
 * — the "we split it 3:2:1, just make the numbers add up" intent, distinct
 * from `distributeShareEvenly`, which pads the gap equally. Cents-exact, so it
 * always lands on 100 rather than 99.99. Returns the input unchanged when
 * there is nothing to scale.
 */
export function normalizeShares(shares: number[]): number[] {
  if (shares.length === 0) return shares;
  const positive = shares.map((s) => (Number.isFinite(s) && s > 0 ? s : 0));
  const sum = positive.reduce((a, b) => a + b, 0);
  if (sum <= 0) return shares;
  // splitByWeights normalises its weights and is cents-exact — exactly this.
  return splitByWeights(100, positive);
}

/** The one key shape for a (platform, budget objective) pair — one argument
 *  order, everywhere, so a reversed call can't silently miss. */
export function budgetComboKey(platform: string, objective: string): string {
  return `${platform}|${objective}`;
}

/** UTC-safe next-day. The module works in ISO dates; this is the only adder. */
export function isoPlusDays(iso: string, days = 1): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Every ISO date from `from` to `to`, inclusive. Empty when `to` precedes it. */
export function isoDaysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let iso = from; iso <= to; iso = isoPlusDays(iso)) out.push(iso);
  return out;
}

// ── Pacing range guards ──────────────────────────────────────────────────────

/**
 * A REAL calendar date, not just the right shape. `2026-99-99` matches the
 * obvious regex and then reaches Postgres as a date literal (500) and the
 * client as an Invalid Date (RangeError), so the check is a round-trip: parse
 * it, format it back, and insist on the same string.
 */
export function isValidIsoDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

/** The widest range Pacing will fetch, in months. */
export const MAX_RANGE_MONTHS = 36;

/** Inclusive month span of a range, by arithmetic — no iteration, no Date. */
export function monthSpan(from: string, to: string): number {
  const y1 = Number(from.slice(0, 4));
  const m1 = Number(from.slice(5, 7));
  const y2 = Number(to.slice(0, 4));
  const m2 = Number(to.slice(5, 7));
  return (y2 * 12 + m2 - (y1 * 12 + m1)) + 1;
}

/**
 * Clamp a range to `MAX_RANGE_MONTHS`, keeping `to` and pulling `from` up —
 * the recent end is the one anyone asked for. Unbounded ranges aren't just
 * slow: over `0001-01-01 … 9999-12-31` the plan query's `inArray` would blow
 * past Postgres's 65535-parameter ceiling. Deliberately arithmetic rather than
 * `monthsInRange().length` — walking ~97k months to discover a range is too
 * long is the very cost this exists to avoid.
 */
export function clampRangeMonths(
  from: string,
  to: string,
  maxMonths = MAX_RANGE_MONTHS,
): { from: string; to: string } {
  if (monthSpan(from, to) <= maxMonths) return { from, to };
  const index = Number(to.slice(0, 4)) * 12 + (Number(to.slice(5, 7)) - 1) - (maxMonths - 1);
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return {
    from: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`,
    to,
  };
}

// ── The reserve as a SHARE of the total (2026-10-17, user decision) ──────────
// "The reserve should be within the percentages." The cascade is total →
// shares of the TOTAL, where the reserve is one share beside the platforms →
// each platform's objective shares. Storage is unchanged (the reserve's
// derived amount lands in budget_targets.reserve_spend_usd, the platform ×
// objective amounts in budget_allocations); these helpers are the one place
// the share ↔ amount arithmetic lives, so no component re-derives it.

export interface TotalSplit {
  /** The reserve's derived amount — the FIRST share of the total. */
  reserve: number;
  /** One amount per platform share, in the order given. */
  platforms: number[];
}

/**
 * Amounts over the TOTAL with the reserve as the first share: one
 * `amountsFromShares` call, so the reserve and the platforms are rounded
 * TOGETHER by largest remainder and the parts sum to the total exactly once
 * the shares reach 100%.
 */
export function splitTotalByShares(
  total: number,
  reserveShare: number,
  platformShares: readonly number[],
): TotalSplit {
  const [reserve = 0, ...platforms] = amountsFromShares(total, [reserveShare, ...platformShares]);
  return { reserve, platforms };
}

export interface StoredPlanShares {
  /** Σ allocations + reserve — the number every share is a share of. */
  total: number;
  /** reserve ÷ total, as a percentage (0 with no total). */
  reserveShare: number;
  /** platform → Σ(its allocations) ÷ total — only planned platforms. */
  platformShares: Record<string, number>;
  /** `platform|objective` → allocation ÷ platform amount. */
  objectiveShares: Record<string, number>;
}

/**
 * The cascade rebuilt from what is STORED, at full precision: every share is
 * its amount over its parent, so deriving straight back through
 * `splitTotalByShares` / `amountsFromShares` gives the stored cents again (a
 * round-trip is exact — pinned). Platforms come out in `ALL_PLATFORMS` order.
 */
export function sharesFromStoredPlan(
  allocations: ReadonlyArray<{ platform: string; objective: string; plannedSpend: number }>,
  reserve: number,
): StoredPlanShares {
  const allocated = round2(allocations.reduce((s, a) => s + a.plannedSpend, 0));
  const total = round2(allocated + reserve);
  const platformShares: Record<string, number> = {};
  const objectiveShares: Record<string, number> = {};
  for (const platform of ALL_PLATFORMS) {
    const rows = allocations.filter((a) => a.platform === platform);
    if (rows.length === 0) continue;
    const platformSum = round2(rows.reduce((s, a) => s + a.plannedSpend, 0));
    platformShares[platform] = shareFromAmount(platformSum, total);
    for (const row of rows) {
      objectiveShares[budgetComboKey(platform, row.objective)] = shareFromAmount(
        row.plannedSpend,
        platformSum,
      );
    }
  }
  return {
    total,
    reserveShare: shareFromAmount(reserve, total),
    platformShares,
    objectiveShares,
  };
}

/** The exact gap to 100% — FULL precision, unlike `shareRemainder`'s 2dp. */
function exactRemainder(shares: readonly number[]): number {
  return 100 - shares.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
}

/**
 * "Send the rest to reserve": the whole gap between the shares and 100% goes
 * into the reserve, platforms untouched. FULL precision on purpose: the
 * platform shares reconstructed from stored cents are long decimals, and a
 * reserve rounded to 2dp of a percent would land $0.15 off the cents they
 * leave (7.69% of $6,500 is $499.85, not the $500 that was stored). An
 * over-assigned split can only be absorbed if the reserve is big enough to
 * give it back; otherwise null — the move isn't possible and the button
 * should not offer it.
 */
export function sendRemainderToReserve(
  reserveShare: number,
  platformShares: readonly number[],
): number | null {
  const next = reserveShare + exactRemainder([reserveShare, ...platformShares]);
  if (next < -SHARE_EPSILON) return null;
  return Math.max(0, next);
}

/**
 * "Distribute remaining evenly": the gap to 100% spread equally across the
 * platforms, the reserve held where it is — undecided money is not pushed
 * into the reserve by this button (that is the other one). Full precision,
 * like the reserve fixer, so the derived amounts sum to the total exactly;
 * an over-assignment is taken back evenly, each platform floored at 0.
 */
export function distributePlatformsEvenly(
  reserveShare: number,
  platformShares: readonly number[],
): number[] {
  if (platformShares.length === 0) return [...platformShares];
  const each = exactRemainder([reserveShare, ...platformShares]) / platformShares.length;
  return platformShares.map((share) => Math.max(0, share + each));
}

// ── The Plan editor's save gate ──────────────────────────────────────────────

export interface PlanGatePlatform {
  label: string;
  /** Share of the TOTAL, as typed. */
  share: number;
  /** The four objective shares under it, as typed. */
  objectiveShares: number[];
}

export interface PlanGateInput {
  total: number;
  /** The reserve's share of the total, as typed (0 = none). */
  reserveShare: number;
  /** A revenue target on its own is a valid plan — see below. */
  hasRevenueTarget: boolean;
  platforms: PlanGatePlatform[];
}

const asPct = (share: number) => `${share.toFixed(1)}%`;

/**
 * Why the plan can't be saved yet, in the planner's words — empty means it can.
 *
 * The 100% rule is deliberate: money you haven't decided on belongs in the
 * RESERVE, not in a silent gap — and since 2026-10-17 the reserve is one of
 * the shares, so the first level is "reserve + platforms = 100% of the
 * total". The one exception is a month planned only as a REVENUE TARGET,
 * which the storage layer has always supported (a target row with no
 * allocations); there is no spend budget to share out, so the share rules
 * simply don't apply — but a reserve can't exist either, since it is carved
 * out of a total.
 */
export function planGateProblems(input: PlanGateInput): string[] {
  const { total, reserveShare, hasRevenueTarget, platforms } = input;
  const out: string[] = [];

  if (total <= 0) {
    if (hasRevenueTarget) {
      if (reserveShare > 0) {
        out.push("A reserve needs a total budget to be carved out of.");
      }
      return out;
    }
    out.push("Set a total budget, or just a revenue target.");
    return out;
  }

  if (reserveShare > 100 + SHARE_EPSILON) {
    out.push("The reserve is larger than the total budget.");
  }
  if (platforms.length === 0) {
    out.push("Give at least one platform a share.");
    return out;
  }

  const shares = [reserveShare, ...platforms.map((p) => p.share)];
  if (!sharesComplete(shares)) {
    const left = shareRemainder(shares);
    const assigned = asPct(100 - left);
    const parts = `reserve ${asPct(reserveShare)} + platforms ${asPct(
      platforms.reduce((s, p) => s + p.share, 0),
    )}`;
    out.push(
      left > 0
        ? `Shares of the total: ${assigned} (${parts}) — ${asPct(left)} unassigned`
        : `Shares of the total: ${assigned} (${parts}) — ${asPct(-left)} over`,
    );
  }
  for (const platform of platforms) {
    if (sharesComplete(platform.objectiveShares)) continue;
    const left = shareRemainder(platform.objectiveShares);
    const assigned = asPct(100 - left);
    out.push(
      left > 0
        ? `${platform.label} objectives: ${assigned} — ${asPct(left)} unassigned`
        : `${platform.label} objectives: ${assigned} — ${asPct(-left)} over`,
    );
  }
  return out;
}

// ── The reserve: what the month has DRAWN (2026-10-17, user decision) ───────

/**
 * How much of the reserve the month has drawn: Σ over platforms of
 * max(0, actual − planned), where `planned` is the platform's WHOLE allocation
 * across its buckets (0 for a platform with no plan at all). Spend beyond the
 * plan at PLATFORM level is what the reserve absorbs; money that lands in a
 * different objective bucket of a planned platform is objective DRIFT — the
 * Tracker shows it as an unplanned row — not a reserve draw. The old rule
 * (every combo with no plan row) read September's Facebook as "past the
 * reserve" while it was under its own plan. Platforms never net against each
 * other: one platform's underspend does not pay for another's overshoot.
 */
export function reserveUsed(
  allocations: ReadonlyArray<{ platform: string; plannedSpend: number }>,
  actualSpendByCombo: ReadonlyArray<{ platform: string; actualSpend: number }>,
): number {
  const planned = new Map<string, number>();
  for (const a of allocations) {
    planned.set(a.platform, (planned.get(a.platform) ?? 0) + a.plannedSpend);
  }
  const actual = new Map<string, number>();
  for (const c of actualSpendByCombo) {
    actual.set(c.platform, (actual.get(c.platform) ?? 0) + c.actualSpend);
  }
  let used = 0;
  for (const [platform, spent] of actual) {
    used += Math.max(0, spent - (planned.get(platform) ?? 0));
  }
  return round2(used);
}

// ── The Overview chart: one month, cumulative (2026-10) ─────────────────────
// Day-grain running totals for a single month, where the actual line STOPS at
// the side's data coverage (a later day is unknown, never zero), the plan is
// the series' own per-day values summed, and the projection is a straight line
// from the last known point to the month-end projection — the SAME number the
// hero card prints, so the chart and the card can never disagree.

/** Running totals of per-day values (index 0 = day 1). */
export function cumulativeSums(days: readonly number[]): number[] {
  const out: number[] = [];
  let run = 0;
  for (const v of days) {
    run += v;
    out.push(run);
  }
  return out;
}

/**
 * Cumulative ROAS per day — each day's revenue-to-date over spend-to-date,
 * through the brand rate. Null wherever nothing has been spent yet (a ratio
 * over zero is no reading at all, not a zero one).
 */
export function cumulativeRoas(
  revenueCumulative: readonly number[],
  spendCumulative: readonly number[],
  rate: number,
): (number | null)[] {
  return spendCumulative.map((spend, i) =>
    roasThroughRate(revenueCumulative[i] ?? 0, spend, rate),
  );
}

export interface MonthChartPoint {
  /** 1-based day of the month. */
  day: number;
  /** Cumulative actual; null past the side's coverage (unknown ≠ 0). */
  actual: number | null;
  /** Cumulative plan; null when the month plans nothing on this side. */
  plan: number | null;
  /** The projection, from the last actual point to month end; null elsewhere. */
  projection: number | null;
}

/**
 * The chart's points for one metric. `actualCumulative` and `planCumulative`
 * are per-day CUMULATIVE values (index 0 = day 1); the actual line stops at
 * `throughDay` and the projection runs from that point to `projected` at the
 * last day, so its endpoint is the hero card's number. No projection when the
 * month is over (nothing left to project), when nothing is known yet, or when
 * the caller has none.
 */
export function monthChartPoints(input: {
  totalDays: number;
  actualCumulative: ReadonlyArray<number | null>;
  /** Days of the month the actual side covers (0..totalDays). */
  throughDay: number;
  planCumulative: ReadonlyArray<number | null> | null;
  projected: number | null;
}): MonthChartPoint[] {
  const { totalDays, actualCumulative, planCumulative, projected } = input;
  const through = Math.max(0, Math.min(totalDays, Math.floor(input.throughDay)));
  const last = through > 0 ? (actualCumulative[through - 1] ?? null) : null;
  const project = projected !== null && last !== null && through < totalDays;
  return Array.from({ length: totalDays }, (_, i) => {
    const day = i + 1;
    let projection: number | null = null;
    if (project && day >= through) {
      const t = (day - through) / (totalDays - through);
      projection = last! + (projected! - last!) * t;
    }
    return {
      day,
      actual: day <= through ? (actualCumulative[i] ?? null) : null,
      plan: planCumulative === null ? null : (planCumulative[i] ?? null),
      projection,
    };
  });
}

// ── The ROAS card (2026-10) ─────────────────────────────────────────────────

export interface RoasFigures {
  /** Month-to-date ROAS through the rate; null before any spend. */
  actual: number | null;
  /** The month's target ROAS; null without a revenue target and a spend plan. */
  target: number | null;
  /** projected revenue ÷ (projected spend × rate); null unless both exist. */
  projected: number | null;
  /** (actual − target) ÷ target — the card's verdict; null without both. */
  deviation: number | null;
}

/**
 * The ROAS card's numbers, all through `roasThroughRate`. The target is the
 * revenue target over the planned spend — a CURVE month's reading; a DAILY
 * month passes its stored `targetRoas` instead (the revenue target was derived
 * from it, so dividing back would only re-find it to the cent). The deviation
 * is `pacingDeviation` against the target, so the card's warn tint rides the
 * same threshold as every other pacing verdict.
 */
export function roasFigures(input: {
  actualRevenueSar: number;
  actualSpendUsd: number;
  plannedRevenueSar: number | null;
  plannedSpendUsd: number;
  /** A daily month's stored target; null makes the function derive it. */
  targetRoas: number | null;
  projectedRevenueSar: number | null;
  projectedSpendUsd: number | null;
  rate: number;
}): RoasFigures {
  const actual = roasThroughRate(input.actualRevenueSar, input.actualSpendUsd, input.rate);
  const target =
    input.targetRoas !== null && input.targetRoas > 0
      ? input.targetRoas
      : input.plannedRevenueSar !== null && input.plannedSpendUsd > 0
        ? roasThroughRate(input.plannedRevenueSar, input.plannedSpendUsd, input.rate)
        : null;
  const projected =
    input.projectedRevenueSar !== null && input.projectedSpendUsd !== null
      ? roasThroughRate(input.projectedRevenueSar, input.projectedSpendUsd, input.rate)
      : null;
  const deviation =
    actual !== null && target !== null ? pacingDeviation(actual, target) : null;
  return { actual, target, projected, deviation };
}

// ── Tracker (2026-09) ────────────────────────────────────────────────────────
// The zero-configuration daily pace board: for every row that has a plan, how
// far through it we are against where the curve says we should be. Pure, so
// the arithmetic is unit-tested rather than eyeballed on a page; the input is
// structural (BudgetMonthData satisfies it) so this module stays free of DB
// imports. NOTHING here re-derives pacing — it composes curveExpected /
// pacingDeviation / projectedMonthEnd, the module's one set of conventions.

/** Exactly what the Tracker needs from `getBudgetMonth()`. */
export interface TrackerInput {
  allocations: ReadonlyArray<{
    platform: string;
    objective: string;
    plannedSpend: number;
  }>;
  actualSpendByCombo: ReadonlyArray<{
    platform: string;
    objective: string;
    actualSpend: number;
  }>;
  plannedRevenueSar: number | null;
  reserveSpendUsd: number;
  dayWeightOverrides: Record<number, number>;
  actualRevenueSar: number;
  /** Plan mode + its inputs — the tracker reads plan-to-date through the series. */
  planMode: PlanMode;
  planDays: ReadonlyArray<PlanDayCell>;
  targetRoas: number | null;
  usdToSarRate: number;
}

/** One bar: a full-month plan, the actual so far, and the curve's mark. */
export interface TrackerBar {
  key: string;
  label: string;
  /** Full-month plan — the bar's TRACK. */
  plan: number;
  /** Month-to-date actual — the bar's FILL. */
  actual: number;
  /** What the curve expects by today — the bar's TICK. */
  planToDate: number;
  /** actual − planToDate (signed; the verdict's magnitude). */
  delta: number;
  /** (actual − planToDate) ÷ planToDate; NULL when nothing is expected yet. */
  deviation: number | null;
}

export interface TrackerPlatform extends TrackerBar {
  /** One bar per PLANNED bucket, in funnel order. */
  buckets: TrackerBar[];
  /**
   * Spend in buckets with no plan row — no bar (there is no track). On a
   * platform that HAS a plan this is objective DRIFT; only spend beyond the
   * platform's whole plan draws the reserve (`reserveUsed`).
   */
  unplanned: number;
  /** The same money, one row per unplanned bucket (funnel order). */
  unplannedBuckets: Array<{ key: string; label: string; actual: number }>;
}

export interface TrackerRevenue extends TrackerBar {
  /** NULL when the month has no revenue target (the bar is not rendered). */
  target: number | null;
}

export interface TrackerData {
  month: string;
  /** Day N of M, by the module's CALENDAR convention (0 future, M past). */
  elapsedDays: number;
  totalDays: number;
  /**
   * The plan's expected fraction AT COVERAGE — "plan expects P% spent". With
   * per-platform coverage it is the plan-weighted blend (Σ expectations ÷
   * total plan), which is exactly the curve fraction when every platform
   * covers the same day.
   */
  curveElapsed: number;
  /** What the comparisons actually anchored to (null = the calendar). */
  coverage: CoverageSummary | null;
  isCurrentMonth: boolean;
  isPastMonth: boolean;
  isFutureMonth: boolean;
  /** The brand total bar (every allocation, every actual). */
  total: TrackerBar;
  /**
   * Month-end projection, CURRENT MONTH ONLY (actual ÷ elapsed curve
   * fraction). NULL on a past month — it is already final — and on a future
   * one, and when the elapsed fraction is 0.
   */
  projectedSpend: number | null;
  /** projectedSpend ÷ plan; NULL without a plan to measure against. */
  projectedPctOfPlan: number | null;
  /** Cards, richest plan first; a platform with neither plan nor spend is out. */
  platforms: TrackerPlatform[];
  /** Σ unplanned across platforms — spend in buckets with no plan row. */
  unplannedTotal: number;
  reserve: number;
  /**
   * What the reserve has absorbed: Σ platforms max(0, actual − plan) — the
   * platform-level rule (`reserveUsed`), never the unplanned-bucket sum.
   */
  reserveUsed: number;
  /** Reserve minus what it has absorbed, floored at 0. */
  reserveRemaining: number;
  revenue: TrackerRevenue;
  /**
   * Month-end revenue projection, CURRENT MONTH ONLY, through the store's own
   * coverage (the same rule as `projectedSpend`); null otherwise.
   */
  projectedRevenue: number | null;
  /** False → the page shows its "plan this month first" hint, not a zero board. */
  hasPlan: boolean;
}

const comboKey = (platform: string, objective: string) => `${platform}|${objective}`;

/**
 * The key the REVENUE side's coverage travels under (the store horizon). Store
 * orders and ad exports are uploaded separately, so the revenue bar must pace
 * against its own last uploaded day — not the ads one, and not the calendar.
 */
export const REVENUE_COVERAGE_KEY = "__revenue__";

function makeBar(
  key: string,
  label: string,
  plan: number,
  actual: number,
  planToDate: number,
): TrackerBar {
  return {
    key,
    label,
    plan,
    actual,
    planToDate,
    delta: round2(actual - planToDate),
    deviation: pacingDeviation(actual, planToDate),
  };
}

// ── Tracker views (2026-10) ─────────────────────────────────────────────────
// The bars and the table read the SAME `buildTrackerRows` output — there is no
// second math path — so everything a view needs beyond those rows is a pure
// derivation here, where it can be tested.

/**
 * Is this row far enough off its pace to be worth looking at? The shared
 * magnitude threshold, in both directions: ahead and behind are both
 * deviations (the module never colours one of them "good"). A row with no
 * verdict yet is not off-pace — it is unjudged.
 */
export function isOffPace(bar: Pick<TrackerBar, "deviation">): boolean {
  return isStrongTone(pacingTone(bar.deviation));
}

export interface TrackerCounts {
  ahead: number;
  onTrack: number;
  behind: number;
}

/**
 * The summary strip's triage, at BUCKET-ROW granularity (the grain somebody
 * can act on). Rows with no expectation yet are counted in none of the three:
 * "on track" has to mean "measured and fine", or the strip quietly launders
 * rows nobody can judge.
 */
export function trackerCounts(
  platforms: readonly TrackerPlatform[],
): TrackerCounts {
  const counts: TrackerCounts = { ahead: 0, onTrack: 0, behind: 0 };
  for (const p of platforms) {
    for (const b of p.buckets) {
      if (b.deviation === null || !Number.isFinite(b.deviation)) continue;
      if (!isOffPace(b)) counts.onTrack += 1;
      else if (b.deviation > 0) counts.ahead += 1;
      else counts.behind += 1;
    }
  }
  return counts;
}

export interface TrackerViewFilters {
  /** Empty = every platform (the zero-config default). */
  platforms?: readonly string[];
  /** Empty = every bucket. */
  buckets?: readonly string[];
  /** Hide anything inside the warn threshold — including the unjudged. */
  offPaceOnly?: boolean;
}

/**
 * Narrow the CARDS/ROWS a view shows. The header's brand total is deliberately
 * NOT recomputed: it is the month's verdict, the same number Overview reports,
 * and a filter is a reading aid rather than a different month. The page says
 * when a filter is hiding something.
 *
 * A platform card survives if the platform passes AND at least one of its
 * rows does — a planned bucket or an unplanned one. Unplanned money follows
 * the SAME bucket predicate (asking for Awareness must not keep an "Other ·
 * unplanned" line), `unplanned` is recomputed as the survivors' sum, and
 * "off-pace only" drops unplanned rows outright: a row with no verdict is not
 * off-pace, which is also why the summary strip counts it in none of its
 * three.
 */
export function filterTrackerPlatforms(
  platforms: readonly TrackerPlatform[],
  f: TrackerViewFilters,
): TrackerPlatform[] {
  const wantPlatform = (p: string) =>
    !f.platforms || f.platforms.length === 0 || f.platforms.includes(p);
  const wantBucket = (b: string) =>
    !f.buckets || f.buckets.length === 0 || f.buckets.includes(b);
  const out: TrackerPlatform[] = [];
  for (const p of platforms) {
    if (!wantPlatform(p.key)) continue;
    const buckets = p.buckets
      .filter((b) => wantBucket(b.label))
      .filter((b) => !f.offPaceOnly || isOffPace(b));
    const unplannedBuckets = f.offPaceOnly
      ? []
      : p.unplannedBuckets.filter((u) => wantBucket(u.label));
    // A platform with nothing left to show — no planned bucket and no
    // unplanned money in the asked-for buckets — is hidden, whether it was
    // planned or unplanned-only.
    if (buckets.length === 0 && unplannedBuckets.length === 0) continue;
    out.push({
      ...p,
      buckets,
      unplannedBuckets,
      unplanned: round2(unplannedBuckets.reduce((s, u) => s + u.actual, 0)),
    });
  }
  return out;
}

/** Rows in the bars view: by plan size (the default) or most off-pace first. */
export function sortTrackerPlatforms(
  platforms: readonly TrackerPlatform[],
  rank: "plan" | "offpace",
): TrackerPlatform[] {
  if (rank === "plan") return [...platforms];
  // Drama on request: biggest |deviation| first, the unjudged last (they are
  // missing information, not a small miss — the house's null rule).
  return [...platforms].sort((a, b) => {
    const av = a.deviation === null ? -1 : Math.abs(a.deviation);
    const bv = b.deviation === null ? -1 : Math.abs(b.deviation);
    return bv - av || b.plan - a.plan;
  });
}

/** One platform's line inside an objective group. */
export interface TrackerObjectiveRow extends TrackerBar {
  platform: string;
  /** Spend with no plan row for this objective × platform. */
  unplanned: boolean;
}

/** An objective bucket across platforms — the allocation check's reading. */
export interface TrackerObjective extends TrackerBar {
  rows: TrackerObjectiveRow[];
}

/**
 * The Tracker's rows REGROUPED by objective (the table's `group=objective`,
 * 2026-10 — where the Overview's allocation check went). Nothing is
 * re-derived: every planned line is the platform's own bucket bar, an
 * unplanned combo is its amount with no expectation (no track, no verdict),
 * and an objective's expectation is the SUM of its rows' — the same rule the
 * brand total follows. Σ actual over the groups equals Σ actual over the
 * platforms, so the table still reconciles to the raw month total.
 */
export function groupTrackerByObjective(
  platforms: readonly TrackerPlatform[],
): TrackerObjective[] {
  const out: TrackerObjective[] = [];
  for (const objective of BUDGET_OBJECTIVES) {
    const rows: TrackerObjectiveRow[] = [];
    for (const p of platforms) {
      const planned = p.buckets.find((b) => b.label === objective);
      if (planned) {
        rows.push({
          ...planned,
          key: `${objective}|${p.key}`,
          label: p.key,
          platform: p.key,
          unplanned: false,
        });
      }
      const drift = p.unplannedBuckets.find((u) => u.label === objective);
      if (drift) {
        rows.push({
          key: `${objective}|${p.key}|unplanned`,
          label: p.key,
          platform: p.key,
          plan: 0,
          actual: drift.actual,
          planToDate: 0,
          delta: drift.actual,
          deviation: null,
          unplanned: true,
        });
      }
    }
    if (rows.length === 0) continue;
    out.push({
      ...makeBar(
        objective,
        objective,
        rows.reduce((s, r) => s + r.plan, 0),
        round2(rows.reduce((s, r) => s + r.actual, 0)),
        rows.reduce((s, r) => s + r.planToDate, 0),
      ),
      rows,
    });
  }
  return out;
}

/**
 * A row's own month-end projection: actual ÷ the share of its plan the
 * reported days account for. NULL when nothing is expected yet (no plan, or no
 * coverage), which is the same rule the brand projection follows.
 */
export function rowProjection(bar: TrackerBar): number | null {
  if (bar.plan <= 0 || bar.planToDate <= 0) return null;
  return round2((bar.actual * bar.plan) / bar.planToDate);
}

export function buildTrackerRows(
  data: TrackerInput,
  month: string,
  todayIso: string,
  /**
   * Latest uploaded day per platform. Omitted = the old calendar anchoring,
   * which is what a caller without a coverage read gets (and what every past
   * month resolves to anyway).
   */
  coverage?: PlatformCoverage,
): TrackerData {
  const monthIso = monthStartIso(month);
  // Plan-to-date comes from the month's SERIES — the tracker never expands a
  // curve (or reads day cells) itself.
  const series = buildPlanSeries(planSeriesSourceOf(data, month));
  const totalDays = daysInMonth(monthIso);
  const elapsedDays = elapsedDaysInMonth(month, todayIso);
  // THE ANCHOR: each platform is compared through the days ITS data covers,
  // never through the calendar (see `coverageDayInMonth`). Without a coverage
  // read the two are the same thing.
  const coverageDay = makeCoverageDay(month, todayIso, coverage);
  const todayMonth = monthKey(todayIso);
  const isCurrentMonth = todayMonth === month;
  const isPastMonth = todayMonth > month;
  const isFutureMonth = todayMonth < month;

  const planByCombo = new Map<string, number>();
  for (const a of data.allocations) {
    const key = comboKey(a.platform, a.objective);
    planByCombo.set(key, (planByCombo.get(key) ?? 0) + a.plannedSpend);
  }
  const actualByCombo = new Map<string, number>();
  for (const c of data.actualSpendByCombo) {
    const key = comboKey(c.platform, c.objective);
    actualByCombo.set(key, (actualByCombo.get(key) ?? 0) + c.actualSpend);
  }

  const platformKeys = [
    ...new Set([
      ...data.allocations.map((a) => a.platform),
      ...data.actualSpendByCombo.map((c) => c.platform),
    ]),
  ];

  const platforms: TrackerPlatform[] = platformKeys.map((platform) => {
    // Buckets in FUNNEL ORDER, derived — never a re-listed vocabulary.
    const buckets: TrackerBar[] = [];
    const unplannedBuckets: TrackerPlatform["unplannedBuckets"] = [];
    let unplanned = 0;
    for (const objective of BUDGET_OBJECTIVES) {
      const key = comboKey(platform, objective);
      const plan = planByCombo.get(key) ?? 0;
      const actual = actualByCombo.get(key) ?? 0;
      // A bar needs a track: spend with no plan can't be barred, it is
      // unplanned money and shows as an amount (objective drift on a planned
      // platform; a reserve draw only when the platform overshoots its plan).
      if (plan > 0) {
        const planToDate = series.spendToDate(
          plan,
          coverageDay(platform),
          (p, o) => p === platform && o === objective,
        );
        buckets.push(makeBar(key, objective, plan, actual, planToDate));
      } else if (actual > 0) {
        unplanned += actual;
        unplannedBuckets.push({ key, label: objective, actual: round2(actual) });
      }
    }
    const plan = buckets.reduce((s, b) => s + b.plan, 0);
    const actual = buckets.reduce((s, b) => s + b.actual, 0) + unplanned;
    return {
      ...makeBar(
        platform,
        platform,
        plan,
        actual,
        series.spendToDate(plan, coverageDay(platform), (p) => p === platform),
      ),
      buckets,
      unplanned: round2(unplanned),
      unplannedBuckets,
    };
  });
  // Richest plan first; ties (and unplanned-only platforms) by actual spend.
  platforms.sort((a, b) => b.plan - a.plan || b.actual - a.actual);

  const totalPlan = data.allocations.reduce((s, a) => s + a.plannedSpend, 0);
  const totalActual = data.actualSpendByCombo.reduce((s, c) => s + c.actualSpend, 0);
  // The brand's expectation is the SUM OF THE ROWS' expectations, not a second
  // calculation over the whole plan: with platforms covering different days
  // those are different numbers, and the one the cards add up to is the honest
  // one. (Uniform coverage makes them identical — the curve is linear in plan.)
  const totalPlanToDate = round2(
    platforms.reduce((s, p) => s + p.planToDate, 0),
  );
  const total = makeBar("total", "Total", totalPlan, totalActual, totalPlanToDate);
  /**
   * The elapsed fraction AT COVERAGE: the plan-weighted share the rows expect.
   * The projection divides by this, so a platform whose data lags no longer
   * drags the month's forecast down with it.
   */
  const coverageFraction =
    totalPlan > 0 ? totalPlanToDate / totalPlan : series.fraction(elapsedDays);

  const unplannedTotal = round2(platforms.reduce((s, p) => s + p.unplanned, 0));
  // The reserve is drawn by PLATFORM-level overshoot, not by bucket drift.
  const used = reserveUsed(data.allocations, data.actualSpendByCombo);

  // The projection is a CURRENT-month reading: a past month is already final,
  // and a future one has nothing to extrapolate from. It divides by the
  // COVERAGE fraction — actual ÷ "how much of the plan the reported days
  // account for" — so a lagging upload no longer reads as underspending.
  const projectedSpend =
    isCurrentMonth && coverageFraction > 0
      ? round2(totalActual / coverageFraction)
      : null;

  // Revenue has its OWN pipeline and therefore its own coverage: the store
  // horizon, passed under the `revenueCoverageKey` sentinel so one map carries
  // both sides. Same rule — compare through the days the data covers.
  const revenueDay = coverageDay(REVENUE_COVERAGE_KEY);
  const target = series.plannedRevenueSar;
  const revenue: TrackerRevenue = {
    ...makeBar(
      "revenue",
      "Revenue",
      target ?? 0,
      data.actualRevenueSar,
      series.revenueToDate(revenueDay),
    ),
    target,
  };
  // Revenue's projection divides by the STORE's covered share of the curve —
  // its own pipeline, its own coverage — and like spend it is a current-month
  // reading only.
  const projectedRevenue = isCurrentMonth
    ? series.projectedMonthEnd(data.actualRevenueSar, revenueDay)
    : null;

  return {
    month,
    elapsedDays,
    totalDays,
    curveElapsed: coverageFraction,
    coverage:
      coverage === undefined
        ? null
        : // Only PLANNED platforms are paced, so only they can lag: naming a
          // platform that has nothing to be compared against would be noise.
          coverageSummary(
            coverage,
            platforms.filter((p) => p.plan > 0).map((p) => p.key),
          ),
    isCurrentMonth,
    isPastMonth,
    isFutureMonth,
    total,
    projectedSpend,
    projectedPctOfPlan:
      projectedSpend !== null && totalPlan > 0 ? projectedSpend / totalPlan : null,
    platforms,
    unplannedTotal,
    reserve: data.reserveSpendUsd,
    reserveUsed: used,
    reserveRemaining: Math.max(0, round2(data.reserveSpendUsd - used)),
    revenue,
    projectedRevenue,
    hasPlan:
      data.allocations.length > 0 ||
      data.plannedRevenueSar !== null ||
      data.reserveSpendUsd > 0,
  };
}
