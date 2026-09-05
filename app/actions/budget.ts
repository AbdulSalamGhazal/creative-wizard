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
  prevMonthKey,
  validateRate,
  validateWeight,
} from "@/lib/budget";
import { MONTH_KEY, planSchema } from "@/validators/budget";
import { replaceBudgetMonth, copyBudgetMonth } from "@/db/queries/budget";

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
    const parsed = planSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid plan" };
    }
    const { month, allocations, plannedRevenueSar, reserveSpendUsd, dayWeights } = parsed.data;

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
    await db.transaction((tx) =>
      replaceBudgetMonth(tx, acct, month, {
        allocations,
        plannedRevenueSar,
        reserveSpendUsd,
        dayWeights: Object.fromEntries(dayWeights.map((w) => [w.day, w.weight])),
      }),
    );

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
      },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

export async function copyBudgetFromLastMonth(input: unknown): Promise<BudgetActionResult> {
  try {
    const user = await requirePermission("budget.manage");
    const parsed = z.object({ month: z.string().regex(MONTH_KEY) }).safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid month." };
    const { month } = parsed.data;
    const from = prevMonthKey(month);
    const acct = await getActiveAccountId();

    const copied = await db.transaction((tx) => copyBudgetMonth(tx, acct, from, month));
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
  return err instanceof Error ? err.message : "Unknown error";
}
