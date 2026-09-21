"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { accounts } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import {
  daysInMonth,
  monthLabel,
  monthStartIso,
  revenueFromRoas,
  validateRate,
  validateWeight,
} from "@/lib/budget";
import {
  convertPlanSchema,
  copyPlanSchema,
  planInputToSnapshot,
  planSchema,
  restoreRevisionSchema,
  savePlanSchema,
  snapshotToPlanInput,
} from "@/validators/budget";
import {
  copyBudgetMonth,
  getBudgetMonth,
  getPlanMode,
  getPlanRevision,
  insertPlanRevision,
  replaceBudgetMonth,
  type BudgetPlanInput,
} from "@/db/queries/budget";
import { actionError } from "@/lib/action-error";
import { notifyRoutes } from "@/db/queries/notifications";
import { usd } from "@/lib/format";

/**
 * Budget mutations — permission `budget.manage`, all audited `budget.update`
 * with the month + a compact diff summary. Any month is editable (no locking —
 * a deliberate decision; the audit trail is the guard).
 */

export interface BudgetActionResult {
  ok: boolean;
  error?: string;
  copied?: number;
}

export async function saveBudgetMonth(input: unknown): Promise<BudgetActionResult> {
  try {
    const user = await requirePermission("budget.manage");
    const parsed = savePlanSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid plan" };
    }
    const {
      month,
      allocations,
      plannedRevenueSar,
      reserveSpendUsd,
      dayWeights,
      note,
      source,
      mode,
      days,
      targetRoas,
    } = parsed.data;

    const problem = planShapeProblem(month, parsed.data);
    if (problem) return { ok: false, error: problem };

    const acct = await getActiveAccountId();
    // One mode at a time: the editor can't write over a day-by-day month —
    // it has to be switched back to editor planning first (convertPlanToCurve),
    // which says out loud that the daily detail is being collapsed.
    if (source === "editor" && (await getPlanMode(db, acct, month)) === "daily") {
      return {
        ok: false,
        error: `${monthLabel(month)} is planned day by day — switch it to editor planning first, or upload a new sheet.`,
      };
    }

    const rate = mode === "daily" ? await brandRate(acct) : 0;
    const toWrite: BudgetPlanInput = {
      allocations,
      // A daily month's target is DERIVED from its ROAS (the client's figure
      // is only what it showed); the writer stores this echo.
      plannedRevenueSar:
        mode === "daily"
          ? targetRoas === null
            ? null
            : revenueFromRoas(
                targetRoas,
                days.reduce((sum, d) => sum + d.plannedSpend, 0),
                rate,
              ) || null
          : plannedRevenueSar,
      reserveSpendUsd,
      dayWeights: Object.fromEntries(dayWeights.map((w) => [w.day, w.weight])),
      mode,
      days,
      targetRoas,
    };
    const written = await db.transaction(async (tx) => {
      const plan = await replaceBudgetMonth(tx, acct, month, toWrite);
      await insertPlanRevision(tx, acct, month, planInputToSnapshot(plan), note ?? null, user.id);
      // Inside the save's own transaction — see the notifications module rule.
      await notifyRoutes(tx, acct, "budget.plan_saved", {
        title: `${monthLabel(month)}'s budget plan was ${source === "upload" ? "uploaded" : "saved"}`,
        body: note?.trim()
          ? note.trim()
          : `${plan.allocations.length} ${
              plan.allocations.length === 1 ? "allocation" : "allocations"
            }, ${usd(plan.allocations.reduce((sum, a) => sum + a.plannedSpend, 0))} planned${
              mode === "daily" ? ", day by day" : ""
            }`,
        href: `/budget/plan?month=${month}`,
        actorUserId: user.id,
        entity: { type: "budget", id: monthStartIso(month) },
      });
      return plan;
    });

    revalidateBudget();
    await logAudit({
      action: AUDIT_ACTIONS.BUDGET_UPDATE,
      entityType: "budget",
      entityId: monthStartIso(month),
      entityLabel: `Plan for ${monthLabel(month)}`,
      actorUserId: user.id,
      meta: {
        // The CSV upload shares this writer — `source` is what keeps the two
        // apart in the trail (see planSourceSchema).
        op: source === "upload" ? "upload" : "save",
        month,
        mode,
        allocations: written.allocations.length,
        plannedSpendTotal: written.allocations.reduce((sum, a) => sum + a.plannedSpend, 0),
        plannedRevenueSar: written.plannedRevenueSar,
        reserveSpendUsd,
        weightOverrides: mode === "curve" ? dayWeights.filter((w) => w.weight !== 1).length : 0,
        dayCells: written.days?.length ?? 0,
        targetRoas: written.targetRoas ?? null,
        note: note ?? null,
      },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

/**
 * What `planSchema` can't see: the month's real length, and duplicates. Shared
 * by save and restore, so a snapshot is held to the same rules as a typed plan.
 */
function planShapeProblem(
  month: string,
  plan: {
    allocations: Array<{ platform: string; objective: string }>;
    dayWeights: Array<{ day: number; weight: number }>;
    mode: "curve" | "daily";
    days: Array<{ day: number; platform: string; objective: string }>;
  },
): string | null {
  // Weights: within the month's real length and the allowed bounds. Weight 1
  // rows are simply not persisted (absent = 1).
  const monthDays = daysInMonth(monthStartIso(month));
  for (const w of plan.dayWeights) {
    if (w.day > monthDays) return `Day ${w.day} doesn't exist in ${monthLabel(month)}.`;
    if (w.weight !== 1 && !validateWeight(w.weight)) {
      return "Weights must be greater than 0 and at most 10.";
    }
  }
  if (new Set(plan.dayWeights.map((w) => w.day)).size !== plan.dayWeights.length) {
    return "Duplicate day weight.";
  }
  // One row per platform×objective (the unique index would refuse anyway —
  // catch it here with a friendlier message). Daily plans derive theirs.
  if (plan.mode === "curve") {
    const combos = new Set(plan.allocations.map((a) => `${a.platform}|${a.objective}`));
    if (combos.size !== plan.allocations.length) return "Duplicate platform × objective row.";
  }
  for (const d of plan.days) {
    if (d.day > monthDays) return `Day ${d.day} doesn't exist in ${monthLabel(month)}.`;
  }
  const cells = new Set(plan.days.map((d) => `${d.day}|${d.platform}|${d.objective}`));
  if (cells.size !== plan.days.length) return "Duplicate day × platform × objective cell.";
  return null;
}

async function brandRate(acct: string): Promise<number> {
  const [row] = await db
    .select({ rate: accounts.usdToSarRate })
    .from(accounts)
    .where(eq(accounts.id, acct))
    .limit(1);
  return Number(row?.rate ?? 3.77);
}

/**
 * Switch a DAILY month back to editor planning. The day cells COLLAPSE to
 * their monthly sums (which the allocations already are), the curve is reset
 * to linear, the target ROAS becomes a plain SAR target at today's rate, and
 * the month is curve mode again. Nothing is lost: the revision written by the
 * daily plan's own save holds every cell, and this write records one too.
 */
export async function convertPlanToCurve(input: unknown): Promise<BudgetActionResult> {
  try {
    const user = await requirePermission("budget.manage");
    const parsed = convertPlanSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid month." };
    const { month, note } = parsed.data;

    const current = await getBudgetMonth(month);
    if (current.planMode !== "daily") {
      return { ok: false, error: `${monthLabel(month)} is already planned in the editor.` };
    }
    const acct = await getActiveAccountId();
    const plan: BudgetPlanInput = {
      allocations: current.allocations.map((a) => ({
        platform: a.platform,
        objective: a.objective,
        plannedSpend: a.plannedSpend,
      })),
      plannedRevenueSar: current.plannedRevenueSar,
      reserveSpendUsd: current.reserveSpendUsd,
      // LINEAR thereafter — the dormant curve from before the month went
      // daily would otherwise quietly come back.
      dayWeights: {},
      mode: "curve",
    };
    const revisionNote =
      note?.trim() || "Switched to editor planning — daily detail collapsed to monthly totals";
    await db.transaction(async (tx) => {
      const written = await replaceBudgetMonth(tx, acct, month, plan);
      await insertPlanRevision(
        tx,
        acct,
        month,
        planInputToSnapshot(written),
        revisionNote,
        user.id,
      );
      await notifyRoutes(tx, acct, "budget.plan_saved", {
        title: `${monthLabel(month)}'s plan was switched to editor planning`,
        body: revisionNote,
        href: `/budget/plan?month=${month}`,
        actorUserId: user.id,
        entity: { type: "budget", id: monthStartIso(month) },
      });
    });

    revalidateBudget();
    await logAudit({
      action: AUDIT_ACTIONS.BUDGET_UPDATE,
      entityType: "budget",
      entityId: monthStartIso(month),
      entityLabel: `Plan for ${monthLabel(month)}`,
      actorUserId: user.id,
      meta: {
        op: "convert",
        month,
        from: "daily",
        to: "curve",
        collapsedDayCells: current.planDays.length,
        allocations: plan.allocations.length,
        plannedRevenueSar: plan.plannedRevenueSar,
      },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

/**
 * Copy a plan from ANY month that has one — not just the previous month. The
 * destination is replaced entirely (allocations, target, reserve, weights) and
 * the result is recorded as a revision inside the same transaction.
 */
export async function copyBudgetFromMonth(input: unknown): Promise<BudgetActionResult> {
  try {
    const user = await requirePermission("budget.manage");
    const parsed = copyPlanSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid month." };
    }
    const { month, from } = parsed.data;
    const acct = await getActiveAccountId();

    const copied = await db.transaction(async (tx) => {
      const result = await copyBudgetMonth(tx, acct, from, month);
      if (result.allocations === 0 && !result.hasTarget) return result;
      await insertPlanRevision(
        tx,
        acct,
        month,
        planInputToSnapshot(result.plan),
        `Copied from ${monthLabel(from)}`,
        user.id,
      );
      // A copy CHANGES the month's plan, so it is a plan_saved event like any
      // other — missed when the spine shipped. Same in-transaction rule.
      await notifyRoutes(tx, acct, "budget.plan_saved", {
        title: `${monthLabel(month)}'s plan was copied from ${monthLabel(from)}`,
        body: `${result.allocations} ${
          result.allocations === 1 ? "allocation" : "allocations"
        } replaced${result.hasTarget ? ", revenue target included" : ""}${
          result.plan.mode === "daily" ? " — planned day by day, like the source" : ""
        }.`,
        href: `/budget/plan?month=${month}`,
        actorUserId: user.id,
        entity: { type: "budget", id: monthStartIso(month) },
      });
      return result;
    });
    if (copied.allocations === 0 && !copied.hasTarget) {
      return { ok: false, error: `${monthLabel(from)} has no plan to copy.` };
    }

    revalidateBudget();
    await logAudit({
      action: AUDIT_ACTIONS.BUDGET_UPDATE,
      entityType: "budget",
      entityId: monthStartIso(month),
      entityLabel: `Plan for ${monthLabel(month)}`,
      actorUserId: user.id,
      meta: {
        op: "copy_from",
        from,
        mode: copied.plan.mode ?? "curve",
        allocations: copied.allocations,
        dayCells: copied.plan.days?.length ?? 0,
        hasTarget: copied.hasTarget,
      },
    });
    return { ok: true, copied: copied.allocations };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

/**
 * Restore a past revision onto its own month. The snapshot is re-validated
 * through `planSchema` FIRST: one written before a vocabulary change (a retired
 * objective, say) fails loudly here rather than being half-applied. The restore
 * is itself a plan write, so it records a new revision of its own.
 */
export async function restorePlanRevision(input: unknown): Promise<BudgetActionResult> {
  try {
    const user = await requirePermission("budget.manage");
    const parsed = restoreRevisionSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid revision." };

    // Account-scoped read: a revision id from another brand is simply not found.
    const revision = await getPlanRevision(parsed.data.revisionId);
    if (!revision) {
      return { ok: false, error: "That revision no longer exists, or can't be read." };
    }

    const plan = planSchema.safeParse(snapshotToPlanInput(revision.snapshot, revision.month));
    if (!plan.success) {
      return {
        ok: false,
        error: `This revision can't be restored — ${plan.error.issues[0]?.message ?? "it no longer matches the current plan format"}.`,
      };
    }

    const shape = planShapeProblem(revision.month, plan.data);
    if (shape) return { ok: false, error: `This revision can't be restored — ${shape}` };

    const acct = await getActiveAccountId();
    const savedAt = new Date(revision.createdAt).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    });
    // The snapshot's MODE comes back with it: a daily revision restores as a
    // daily month (its cells, its ROAS), a curve one — including every
    // snapshot from before modes existed — as a curve month.
    const restoredMode = plan.data.mode;
    const rate = restoredMode === "daily" ? await brandRate(acct) : 0;
    const restored: BudgetPlanInput = {
      allocations: plan.data.allocations,
      plannedRevenueSar:
        restoredMode === "daily"
          ? plan.data.targetRoas === null
            ? null
            : revenueFromRoas(
                plan.data.targetRoas,
                plan.data.days.reduce((sum, d) => sum + d.plannedSpend, 0),
                rate,
              ) || null
          : plan.data.plannedRevenueSar,
      reserveSpendUsd: plan.data.reserveSpendUsd,
      dayWeights: Object.fromEntries(plan.data.dayWeights.map((w) => [w.day, w.weight])),
      mode: restoredMode,
      days: plan.data.days,
      targetRoas: plan.data.targetRoas,
    };
    await db.transaction(async (tx) => {
      const written = await replaceBudgetMonth(tx, acct, revision.month, restored);
      await insertPlanRevision(
        tx,
        acct,
        revision.month,
        planInputToSnapshot(written),
        `Restored from ${savedAt} UTC`,
        user.id,
      );
      await notifyRoutes(tx, acct, "budget.plan_restored", {
        title: `${monthLabel(revision.month)}'s plan was restored to the ${savedAt} UTC revision`,
        body: revision.note ?? null,
        href: `/budget/plan?month=${revision.month}`,
        actorUserId: user.id,
        entity: { type: "budget", id: monthStartIso(revision.month) },
      });
    });

    revalidateBudget();
    await logAudit({
      action: AUDIT_ACTIONS.BUDGET_UPDATE,
      entityType: "budget",
      entityId: monthStartIso(revision.month),
      entityLabel: `Plan for ${monthLabel(revision.month)}`,
      actorUserId: user.id,
      meta: {
        op: "restore",
        month: revision.month,
        revisionId: revision.id,
        restoredFrom: revision.createdAt,
        mode: restoredMode,
        allocations: plan.data.allocations.length,
      },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

export async function setUsdToSarRate(input: unknown): Promise<BudgetActionResult> {
  try {
    const user = await requirePermission("budget.manage");
    const parsed = z.number().safeParse(input);
    if (!parsed.success || !validateRate(parsed.data)) {
      return { ok: false, error: "Rate must be greater than 0 and at most 100." };
    }
    const acct = await getActiveAccountId();
    await db
      .update(accounts)
      .set({ usdToSarRate: parsed.data.toFixed(4) })
      .where(eq(accounts.id, acct));

    revalidateBudget();
    await logAudit({
      action: AUDIT_ACTIONS.BUDGET_UPDATE,
      entityType: "budget",
      entityId: null,
      entityLabel: `USD→SAR rate ${parsed.data.toFixed(4)}`,
      actorUserId: user.id,
      meta: { op: "rate", rate: parsed.data },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

function revalidateBudget() {
  try {
    revalidatePath("/budget");
    revalidatePath("/budget/plan");
    revalidatePath("/budget/pacing");
  } catch (err) {
    console.warn("revalidatePath after budget change failed:", err);
  }
}

function errMsg(err: unknown): string {
  return actionError(err, "budget");
}
