/**
 * Pure math + month helpers for the Budget module. Standing decisions this
 * module encodes (do not "fix"):
 * - Spend is planned/actualized in USD; revenue is SAR only. The two currencies
 *   meet ONLY through the per-brand USD→SAR rate (ROAS-through-rate below).
 * - Pacing deviation is a MAGNITUDE (over- and under-pace are both deviations)
 *   — warn-tinted, never green/red good/bad. Same philosophy as Reconciliation.
 */

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
 * Day 1 counts as 1 elapsed day (pacing assumes the day's spend is in flight).
 */
export function elapsedDaysInMonth(month: string, todayIso: string): number {
  const total = daysInMonth(monthStartIso(month));
  if (monthKey(todayIso) < month) return 0; // future month
  if (monthKey(todayIso) > month) return total; // past month
  return Math.min(total, Number(todayIso.slice(8, 10)));
}

/** Linear expected-to-date share of a monthly plan. */
export function pacingExpected(
  planned: number,
  elapsedDays: number,
  totalDays: number,
): number {
  if (totalDays <= 0) return 0;
  return (planned * elapsedDays) / totalDays;
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
  return (actual - expected) / expected;
}

/** |deviation| at/above this is a "large" pacing miss → strong warn tint. */
export const PACING_WARN_THRESHOLD = 0.15;

/** Tone for a pacing deviation — magnitude-based, like Reconciliation's Δ. */
export function pacingTone(deviation: number | null): "muted" | "warn" {
  if (deviation === null) return "muted";
  return Math.abs(deviation) >= PACING_WARN_THRESHOLD ? "warn" : "muted";
}

/** "on track" / "12% ahead" / "8% behind" (rounded, magnitude-worded). */
export function pacingVerdict(deviation: number | null): string {
  if (deviation === null) return "—";
  const pct = Math.round(Math.abs(deviation) * 100);
  if (pct === 0) return "on track";
  return `${pct}% ${deviation > 0 ? "ahead" : "behind"}`;
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

/** Plan-to-date through the curve — replaces linear `pacingExpected` in Budget. */
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
 * Set row `index` to `pct` of the group's total, holding that total fixed: the
 * row takes its share and the SIBLINGS absorb the rest in proportion to what
 * they already hold (evenly if they are all zero). A group with one row is
 * always 100% of itself, so its percentage is not editable — the amounts come
 * back unchanged.
 */
export function redistributeByPct(
  amounts: number[],
  index: number,
  pct: number,
  total?: number,
): number[] {
  if (index < 0 || index >= amounts.length) return amounts;
  if (amounts.length < 2) return amounts;
  const groupTotal = round2(total ?? amounts.reduce((s, a) => s + a, 0));
  if (groupTotal <= 0) return amounts;
  const share = Math.min(100, Math.max(0, Number.isFinite(pct) ? pct : 0));
  const target = round2((groupTotal * share) / 100);
  const others = amounts.map((a, i) => (i === index ? 0 : a));
  const parts = splitByWeights(groupTotal - target, others.filter((_, i) => i !== index));
  const out: number[] = [];
  let p = 0;
  for (let i = 0; i < amounts.length; i++) {
    out.push(i === index ? target : parts[p++]!);
  }
  return out;
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

/** Scale every amount by ±pct (10 → ×1.10), each rounded to 2dp. */
export function scaleAll(amounts: number[], pct: number): number[] {
  if (!Number.isFinite(pct)) return amounts;
  const factor = 1 + pct / 100;
  if (factor < 0) return amounts.map(() => 0);
  return amounts.map((a) => round2(a * factor));
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
    const key = `${row.platform}|${objective}`;
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

/** UTC-safe ISO date arithmetic (the whole module works in UTC dates). */
function isoPlusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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

/** What a month contributes to a stitched plan: its scoped total + its curve. */
export interface MonthPlan {
  /** YYYY-MM */
  month: string;
  plannedSpend: number;
  plannedRevenueSar: number | null;
  dayWeights: Record<number, number>;
}

/**
 * Planned amounts per ISO date across every month a range touches. Months with
 * no plan contribute nothing (not zero-filled days — the caller distinguishes
 * "no plan" from "planned zero" by the map being empty for that month).
 */
export function stitchPlanByDay(
  months: MonthPlan[],
  pick: (m: MonthPlan) => number | null,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of months) {
    const planned = pick(m);
    if (planned === null) continue;
    const start = monthStartIso(m.month);
    const increments = monthDayIncrements(start, m.dayWeights, planned);
    increments.forEach((value, i) => {
      out.set(`${start.slice(0, 8)}${String(i + 1).padStart(2, "0")}`, value);
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

export interface ReserveTransfer {
  /** Per-platform amounts after the move — only the target changed. */
  amounts: number[];
  /** What's left in the reserve. */
  reserve: number;
  /** The new allocatable (the total is unchanged; the reserve shrank). */
  allocatable: number;
  /** Shares of the NEW allocatable — full precision, so no row drifts a cent. */
  shares: number[];
}

/**
 * Move money out of the reserve and into ONE platform. This is a transfer, not
 * a re-plan: every other platform keeps its exact dollars, and only their
 * displayed percentages move (the allocatable grew beneath them). Returns null
 * when there isn't that much reserve to move.
 */
export function transferFromReserve(
  amounts: number[],
  index: number,
  transfer: number,
  reserve: number,
): ReserveTransfer | null {
  if (index < 0 || index >= amounts.length) return null;
  if (!Number.isFinite(transfer) || transfer <= 0) return null;
  const moved = round2(transfer);
  if (moved > round2(reserve)) return null;

  const next = amounts.map((a, i) => (i === index ? round2(a + moved) : a));
  const allocatable = round2(next.reduce((s, a) => s + a, 0));
  return {
    amounts: next,
    reserve: round2(reserve - moved),
    allocatable,
    shares: next.map((a) => shareFromAmount(a, allocatable)),
  };
}
