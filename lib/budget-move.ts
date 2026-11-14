import {
  BUDGET_OBJECTIVES,
  neededPerDay,
  round2,
  splitByWeights,
  type BudgetObjective,
} from "@/lib/budget";
import type { RangeModel } from "@/lib/budget-range";

/**
 * MOVE MONEY, from Today (2026-11-14, the Budget restructure) — shift part of
 * a month's plan from one platform (or the reserve) to another without
 * opening the editor, and SEE what it does to each remaining day before
 * saving.
 *
 * A transfer, never a re-plan: the target's dollars rise by exactly the
 * amount, the source's fall by exactly the amount, the total and every other
 * line are untouched. Inside a platform the money leaves and arrives in
 * proportion to its objective buckets (cents-exact through `splitByWeights`),
 * so the split it was planned with is kept.
 *
 * The page posts the MOVE, not the plan: the server re-reads the stored plan
 * and applies it there, so a stale tab can't overwrite a colleague's edit.
 */

export type MoveSource = { kind: "reserve" } | { kind: "platform"; platform: string };

export interface PlanMove {
  from: MoveSource;
  /** The platform receiving the money — it must already be in the plan. */
  to: string;
  amount: number;
}

export interface MovablePlan {
  allocations: ReadonlyArray<{ platform: string; objective: BudgetObjective; plannedSpend: number }>;
  reserveSpendUsd: number;
}

export type MoveResult =
  | { ok: true; allocations: MovablePlan["allocations"]; reserveSpendUsd: number }
  | { ok: false; error: string };

function platformTotal(plan: MovablePlan, platform: string): number {
  return round2(
    plan.allocations.filter((a) => a.platform === platform).reduce((s, a) => s + a.plannedSpend, 0),
  );
}

/** Re-split one platform's buckets onto a new total, keeping their proportions. */
function rescale(plan: MovablePlan, platform: string, total: number): MovablePlan["allocations"] {
  const own = plan.allocations.filter((a) => a.platform === platform);
  const amounts = splitByWeights(total, own.map((a) => a.plannedSpend));
  return own.map((a, i) => ({ ...a, plannedSpend: amounts[i] ?? 0 }));
}

export function applyPlanMove(plan: MovablePlan, move: PlanMove): MoveResult {
  const amount = round2(move.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Enter an amount to move." };
  const toTotal = platformTotal(plan, move.to);
  if (toTotal <= 0) return { ok: false, error: "Pick a platform that is in the plan." };

  let reserve = round2(plan.reserveSpendUsd);
  let fromPlatform: string | null = null;
  if (move.from.kind === "reserve") {
    if (amount > reserve) return { ok: false, error: "That is more than the reserve holds." };
    reserve = round2(reserve - amount);
  } else {
    fromPlatform = move.from.platform;
    if (fromPlatform === move.to) return { ok: false, error: "Pick two different platforms." };
    const fromTotal = platformTotal(plan, fromPlatform);
    if (amount > fromTotal) return { ok: false, error: "That is more than the platform is planned." };
  }

  const allocations = [
    ...plan.allocations.filter((a) => a.platform !== move.to && a.platform !== fromPlatform),
    ...rescale(plan, move.to, round2(toTotal + amount)),
    ...(fromPlatform
      ? rescale(plan, fromPlatform, round2(platformTotal(plan, fromPlatform) - amount))
      : []),
  ]
    .filter((a) => a.plannedSpend > 0)
    .sort(
      (a, b) =>
        a.platform.localeCompare(b.platform) ||
        BUDGET_OBJECTIVES.indexOf(a.objective) - BUDGET_OBJECTIVES.indexOf(b.objective),
    );
  return { ok: true, allocations, reserveSpendUsd: reserve };
}

export interface MovePreviewLine {
  /** A platform key, or "reserve". */
  key: string;
  planBefore: number;
  planAfter: number;
  /** What each remaining day must spend to land on plan (null = nothing left to spend). */
  neededBefore: number | null;
  neededAfter: number | null;
}

/**
 * What the move does, on the board's own terms: each touched platform's plan
 * and needed-per-day, before and after, through ITS covered day — the same
 * `neededPerDay` the board prints. The reserve line carries amounts only.
 */
export function previewMove(model: RangeModel, plan: MovablePlan, move: PlanMove): MovePreviewLine[] | null {
  const result = applyPlanMove(plan, move);
  if (!result.ok) return null;
  const after: MovablePlan = result;
  const line = (platform: string): MovePreviewLine => {
    const row = model.board.platforms.find((p) => p.key === platform);
    const actual = row?.actual ?? 0;
    const through = row?.through ?? null;
    const planBefore = platformTotal(plan, platform);
    const planAfter = platformTotal(after, platform);
    const needed = (planned: number) =>
      neededPerDay({ plan: planned, actual }, through, model.from, model.to);
    return { key: platform, planBefore, planAfter, neededBefore: needed(planBefore), neededAfter: needed(planAfter) };
  };
  const lines: MovePreviewLine[] = [];
  if (move.from.kind === "reserve") {
    lines.push({
      key: "reserve",
      planBefore: round2(plan.reserveSpendUsd),
      planAfter: result.reserveSpendUsd,
      neededBefore: null,
      neededAfter: null,
    });
  } else {
    lines.push(line(move.from.platform));
  }
  lines.push(line(move.to));
  return lines;
}
