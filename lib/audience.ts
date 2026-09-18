import { isoDaysBetween, round2 } from "@/lib/budget";

/**
 * Funnel-audience tracking — the pure layer.
 *
 * The team measures audience size per funnel stage per platform IRREGULARLY:
 * some stages daily, some weekly, some when someone remembers. Everything here
 * follows from that one fact:
 *
 *  - between snapshots the last known value CARRIES FORWARD as a step — never
 *    interpolate, because nobody measured the days in between;
 *  - before a (platform, stage)'s first snapshot the size is UNKNOWN — `null`,
 *    rendered as an em-dash, never 0;
 *  - every displayed size carries its age, so a number measured three weeks ago
 *    can never pass for today's;
 *  - pressure counts ONLY the days whose audience is known.
 *
 * v1 stores no audience definitions and no target bands — numbers and dates
 * only. Judgment stays with the team.
 */

/**
 * The stage vocabulary lives in `lib/funnel-stages.ts` — hoisted there when
 * creatives gained a manual `stages` field, so both sides share ONE definition
 * (still derived from `BUDGET_OBJECTIVES` minus "Other"). Re-exported here so
 * every existing audience import keeps working.
 */
export {
  FUNNEL_STAGES,
  STAGE_SHORT,
  isFunnelStage,
  stageLabel,
  type FunnelStage,
} from "@/lib/funnel-stages";

/** One (platform, stage) pair — the grain of everything in this module. */
export function audienceKey(platform: string, stage: string): string {
  return `${platform}|${stage}`;
}

/** Whole days between two ISO dates (b − a). Both parse as UTC midnight. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * How old a measurement is, in whole days, as of `today`. A snapshot dated in
 * the future (a backfill typo that slipped past the action's guard) reads as
 * 0 rather than a negative age.
 */
export function stalenessDays(asOf: string, today: string): number {
  return Math.max(0, daysBetween(asOf, today));
}

/**
 * The single staleness threshold for the whole module. One neutral line: older
 * than a week and the number gets a warn tint. It says "this is old", NOT "this
 * is bad" — v1 passes no judgment on audience size itself.
 */
export const STALE_AFTER_DAYS = 7;

export function isStale(ageDays: number | null): boolean {
  return ageDays !== null && ageDays > STALE_AFTER_DAYS;
}

/** "as of Sep 9 · 3d ago" — the caption every displayed size carries. */
export function asOfLabel(asOf: string | null, ageDays: number | null): string {
  if (asOf === null) return "never measured";
  const label = new Date(`${asOf}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  if (ageDays === null) return `as of ${label}`;
  if (ageDays === 0) return `as of ${label} · today`;
  return `as of ${label} · ${ageDays}d ago`;
}

export interface AudienceSnapshot {
  date: string;
  size: number;
}

/** One day of a carried-forward series. */
export interface AudienceDay {
  date: string;
  /** The last known size on or before this day — null before the first one. */
  size: number | null;
  /** The date that size was measured on. */
  asOf: string | null;
  /** How old the measurement was ON THIS DAY (0 = measured that day). */
  ageDays: number | null;
}

/**
 * Carry the last known size forward across a range as a STEP.
 *
 * `snapshots` may include measurements from before `from` — that seed is what
 * makes the first days of the range known at all (the query layer fetches it
 * deliberately). Days before the very first snapshot stay `null`: unknown is
 * not zero, and an audience that hasn't been measured yet must never read as
 * an empty one.
 */
export function carryForwardSeries(
  from: string,
  to: string,
  snapshots: readonly AudienceSnapshot[],
): AudienceDay[] {
  const sorted = [...snapshots].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const out: AudienceDay[] = [];
  let i = 0;
  let current: AudienceSnapshot | null = null;
  for (const date of isoDaysBetween(from, to)) {
    while (i < sorted.length && sorted[i]!.date <= date) {
      current = sorted[i]!;
      i++;
    }
    out.push({
      date,
      size: current?.size ?? null,
      asOf: current?.date ?? null,
      ageDays: current ? daysBetween(current.date, date) : null,
    });
  }
  return out;
}

/** A day's audience beside that day's spend — what pressure is computed from. */
export interface PressureDay {
  size: number | null;
  spend: number;
}

/**
 * Pressure = average daily spend per 1,000 audience, over the days whose
 * audience is KNOWN.
 *
 * Computed as component sums (Σspend ÷ Σ(size/1000)), never as the mean of
 * per-day ratios — the house aggregation rule, and the only version that stays
 * right when the audience changes mid-window. Days with no known audience are
 * dropped entirely rather than counted as zero; with none left, or with a known
 * audience of zero, the answer is unknown (`null` → an em-dash), not infinity.
 */
export function pressure(days: readonly PressureDay[]): number | null {
  let spend = 0;
  let thousands = 0;
  let known = 0;
  for (const d of days) {
    if (d.size === null) continue;
    known++;
    spend += d.spend;
    thousands += d.size / 1000;
  }
  if (known === 0 || thousands <= 0) return null;
  return round2(spend / thousands);
}

/** The days of a series whose audience is known — the pressure denominator. */
export function knownDays(days: readonly AudienceDay[]): number {
  return days.reduce((n, d) => n + (d.size === null ? 0 : 1), 0);
}

/** Mean of the KNOWN sizes across a range (null when nothing is known). */
export function averageKnownSize(days: readonly AudienceDay[]): number | null {
  let sum = 0;
  let n = 0;
  for (const d of days) {
    if (d.size === null) continue;
    sum += d.size;
    n++;
  }
  return n === 0 ? null : Math.round(sum / n);
}
