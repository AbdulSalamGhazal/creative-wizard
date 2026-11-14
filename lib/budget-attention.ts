import {
  PACING_WARN_THRESHOLD,
  isoDaysBetween,
  round2,
  type PlatformCoverage,
} from "@/lib/budget";
import type { RangeModel } from "@/lib/budget-range";

/**
 * NEEDS ATTENTION (2026-11-14, the Budget restructure) — the short list Today
 * opens with: what in this month wants a decision, most urgent first. It is
 * DATA, not words: the page (and the MCP) phrase each item, so the rule and
 * its wording can't drift apart.
 *
 * Nothing here is a new estimate. Every figure is the board's own row
 * (`buildRangeBoard`): the deviation, the row's projection, what each
 * remaining day needs. The only arithmetic added is a run-rate — actual ÷ the
 * days the platform has REPORTED (never the calendar) — and the projected
 * reserve draw, which is the `reserveUsed` rule applied to the rows'
 * projections.
 *
 * Only a month that is still running has anything to act on: a final month
 * is Review's subject, a future one has no actuals.
 */

/** A platform this many days behind the freshest one is named as stale. */
export const STALE_AFTER_DAYS = 2;

export type AttentionItem =
  | {
      kind: "pace";
      platform: string;
      direction: "ahead" | "behind";
      /** (actual − expected) ÷ expected, signed. */
      deviation: number;
      /** actual − expected through the platform's own day (USD, signed). */
      delta: number;
      /** What each remaining day must spend to land on plan (null = nothing left). */
      neededPerDay: number | null;
      /** actual ÷ the days the platform has reported so far. */
      runRate: number;
      /** Where this pace lands at month end. */
      projection: number | null;
      plan: number;
    }
  | {
      kind: "reserve";
      /** Projected month-end draw on the reserve (Σ platforms max(0, projection − plan)). */
      projectedUse: number;
      reserve: number;
      /** projectedUse − reserve: how far past the reserve this pace lands. */
      exceededBy: number;
      /** Already drawn today. */
      used: number;
    }
  | {
      kind: "stale";
      platform: string;
      /** Its last uploaded day (null = nothing ever). */
      date: string | null;
      /** Days behind the freshest platform. */
      daysBehind: number | null;
    }
  | {
      kind: "unplanned";
      platform: string;
      /** Spent this month on a platform the plan gives nothing. */
      amount: number;
    };

function daysBetween(a: string, b: string): number {
  return a >= b ? 0 : isoDaysBetween(a, b).length - 1;
}

export function buildAttention(
  model: RangeModel,
  coverage: PlatformCoverage,
): AttentionItem[] {
  if (model.card.spend.state !== "live") return [];
  const rows = model.board.platforms;
  const items: AttentionItem[] = [];

  // 1 · The reserve: where the rows' own projections land against it.
  if (model.reserve.kind === "month") {
    const projectedUse = round2(
      rows.reduce((sum, r) => {
        if (r.plan <= 0) return sum + r.actual;
        const landing = r.projection ?? r.actual;
        return sum + Math.max(0, landing - r.plan);
      }, 0),
    );
    const { reserve, used } = model.reserve;
    if (projectedUse > reserve && projectedUse > 0) {
      items.push({
        kind: "reserve",
        projectedUse,
        reserve,
        exceededBy: round2(projectedUse - reserve),
        used,
      });
    }
  }

  // 2 · Platforms far off their pace, furthest first.
  const paced: Extract<AttentionItem, { kind: "pace" }>[] = [];
  for (const r of rows) {
    if (r.plan <= 0 || r.deviation === null || r.through === null) continue;
    if (Math.abs(r.deviation) < PACING_WARN_THRESHOLD) continue;
    const reportedDays = isoDaysBetween(model.from, r.through).length;
    paced.push({
      kind: "pace",
      platform: r.key,
      direction: r.deviation > 0 ? "ahead" : "behind",
      deviation: r.deviation,
      delta: r.delta,
      neededPerDay: r.neededPerDay,
      runRate: reportedDays > 0 ? round2(r.actual / reportedDays) : 0,
      projection: r.projection,
      plan: r.plan,
    });
  }
  paced.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  items.push(...paced);

  // 3 · Spend on a platform the plan gives nothing.
  for (const r of rows) {
    if (r.plan <= 0 && r.actual > 0) {
      items.push({ kind: "unplanned", platform: r.key, amount: round2(r.actual) });
    }
  }

  // 4 · Planned platforms whose data trails the freshest upload.
  const freshest = model.horizon;
  for (const r of rows) {
    if (r.plan <= 0) continue;
    const date = coverage[r.key] ?? null;
    if (date === null) {
      if (freshest !== null) items.push({ kind: "stale", platform: r.key, date, daysBehind: null });
      continue;
    }
    if (freshest === null) continue;
    const behind = daysBetween(date, freshest);
    if (behind > STALE_AFTER_DAYS) {
      items.push({ kind: "stale", platform: r.key, date, daysBehind: behind });
    }
  }

  return items;
}
