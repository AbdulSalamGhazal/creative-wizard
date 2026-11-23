"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { actionError } from "@/lib/action-error";
import { storeProductCostDeleteSchema, storeProductCostSchema } from "@/validators/store";
import { deleteStoreProductCost, upsertStoreProductCost } from "@/db/queries/store-costs";

/**
 * Store → Product costs (permission `config.store`, like Order fields). A cost
 * is per unit, SAR, from a day; saving the same product and day again replaces
 * that day's cost. Audited as `store.cost_set` / `store.cost_delete`.
 */

export interface StoreCostResult {
  ok: boolean;
  error?: string;
}

function revalidateSafe() {
  try {
    revalidatePath("/store/costs");
  } catch (err) {
    console.warn("revalidatePath after a product cost change failed:", err);
  }
}

export async function setStoreProductCost(input: unknown): Promise<StoreCostResult> {
  try {
    const me = await requirePermission("config.store");
    const parsed = storeProductCostSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const acct = await getActiveAccountId();
    const { productKey, unitCost, effectiveFrom } = parsed.data;
    await upsertStoreProductCost({ accountId: acct, productKey, unitCost, effectiveFrom, userId: me.id });
    revalidateSafe();
    await logAudit({
      action: AUDIT_ACTIONS.STORE_COST_SET,
      entityType: "store",
      actorUserId: me.id,
      meta: { productKey, unitCost, effectiveFrom },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, "store_cost") };
  }
}

export async function deleteStoreProductCostAction(input: unknown): Promise<StoreCostResult> {
  try {
    const me = await requirePermission("config.store");
    const parsed = storeProductCostDeleteSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid input" };
    const acct = await getActiveAccountId();
    const gone = await deleteStoreProductCost(acct, parsed.data.id);
    if (!gone) return { ok: false, error: "That cost was already removed. Reload to see the latest." };
    revalidateSafe();
    await logAudit({
      action: AUDIT_ACTIONS.STORE_COST_DELETE,
      entityType: "store",
      actorUserId: me.id,
      meta: gone,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, "store_cost") };
  }
}
