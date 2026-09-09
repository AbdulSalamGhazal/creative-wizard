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
  validateRate,
  validateWeight,
} from "@/lib/budget";
import {
  copyPlanSchema,
  planInputToSnapshot,
  planSchema,
  restoreRevisionSchema,
  savePlanSchema,
  snapshotToPlanInput,
} from "@/validators/budget";
import {
  copyBudgetMonth,
  getPlanRevision,
  insertPlanRevision,
  replaceBudgetMonth,
} from "@/db/queries/budget";
import { actionError } from "@/lib/action-error";

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
    const { month, allocations, plannedRevenueSar, reserveSpendUsd, dayWeights, note } =
      parsed.data;

    // Weights: within the month's real length and the allowed bounds. Weight 1
    // rows are simply not persisted (absent = 1).
    const monthDays = daysInMonth(monthStartIso(month));
    for (const w of dayWeights) {
      if (w.day > monthDays) {
        return { ok: false, error: `Day ${w.day} doesn't exist in ${monthLabel(month)}.` };
      }
      if (w.weight !== 1 && !validateWeight(w.weight)) {
        return { ok: false, error: "Weights must be greater than 0 and at most 10." };
      }
    }
    const weightDays = new Set(dayWeights.map((w) => w.day));
    if (weightDays.size !== dayWeights.length) {
      return { ok: false, error: "Duplicate day weight." };
    }

    // One row per platform×objective (the unique index would refuse anyway —
    // catch it here with a friendlier message).
    const combos = new Set(allocations.map((a) => `${a.platform}|${a.objective}`));
    if (combos.size !== allocations.length) {
      return { ok: false, error: "Duplicate platform × objective row." };
    }

    const acct = await getActiveAccountId();
    const plan = {
      allocations,
      plannedRevenueSar,
      reserveSpendUsd,
      dayWeights: Object.fromEntries(dayWeights.map((w) => [w.day, w.weight])),
    };
    await db.transaction(async (tx) => {
      await replaceBudgetMonth(tx, acct, month, plan);
      await insertPlanRevision(tx, acct, month, planInputToSnapshot(plan), note ?? null, user.id);
    });

    revalidateBudget();
    await logAudit({
      action: AUDIT_ACTIONS.BUDGET_UPDATE,
      entityType: "budget",
      entityId: monthStartIso(month),
      entityLabel: `Plan for ${monthLabel(month)}`,
      actorUserId: user.id,
      meta: {
        op: "save",
        month,
        allocations: allocations.length,
        plannedSpendTotal: allocations.reduce((s, a) => s + a.plannedSpend, 0),
        plannedRevenueSar,
        reserveSpendUsd,
        weightOverrides: dayWeights.filter((w) => w.weight !== 1).length,
        note: note ?? null,
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
      meta: { op: "copy_from", from, allocations: copied.allocations, hasTarget: copied.hasTarget },
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

    const acct = await getActiveAccountId();
    const savedAt = new Date(revision.createdAt).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    });
    const restored = {
      allocations: plan.data.allocations,
      plannedRevenueSar: plan.data.plannedRevenueSar,
      reserveSpendUsd: plan.data.reserveSpendUsd,
      dayWeights: Object.fromEntries(plan.data.dayWeights.map((w) => [w.day, w.weight])),
    };
    await db.transaction(async (tx) => {
      await replaceBudgetMonth(tx, acct, revision.month, restored);
      await insertPlanRevision(
        tx,
        acct,
        revision.month,
        planInputToSnapshot(restored),
        `Restored from ${savedAt} UTC`,
        user.id,
      );
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
    revalidatePath("/budget/daily");
    revalidatePath("/budget/history");
  } catch (err) {
    console.warn("revalidatePath after budget change failed:", err);
  }
}

function errMsg(err: unknown): string {
  return actionError(err, "budget");
}
