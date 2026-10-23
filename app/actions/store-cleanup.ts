"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import {
  previewStoreCleanup,
  deleteStoreOrders,
  type StoreCleanupPreview,
} from "@/db/queries/store";
import { storeCleanupExpectedSchema, storeCleanupFiltersSchema } from "@/validators/store";
import { CLEANUP_SCOPE_CHANGED, CleanupScopeChangedError } from "@/lib/cleanup-guard";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { actionError } from "@/lib/action-error";

/**
 * Order-cleanup actions — the Store-module twin of the ads `cleanup.ts`. A
 * sanctioned filtered hard-delete of `store_orders` (alongside batch rollback):
 * gated by `store.cleanup`, requires ≥1 filter, preview-then-typed-confirm, and
 * audit-logged with the exact selection + the count actually removed.
 */

export interface StorePreviewResult {
  ok: boolean;
  error?: string;
  preview?: StoreCleanupPreview;
}

export interface StoreCleanupResult {
  ok: boolean;
  error?: string;
  deleted?: number;
}

/** Count + summarize what a selection would remove. Read-only. */
export async function previewStoreCleanupAction(
  input: unknown,
): Promise<StorePreviewResult> {
  try {
    await requirePermission("store.cleanup");
    const parsed = storeCleanupFiltersSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid filters" };
    }
    const preview = await previewStoreCleanup(parsed.data);
    return { ok: true, preview };
  } catch (err) {
    return { ok: false, error: actionError(err, "store_cleanup") };
  }
}

/**
 * Permanently delete the store orders matching the selection — exactly the
 * count the user previewed (`expectedRows`), or nothing (W1-7).
 */
export async function runStoreCleanup(input: unknown): Promise<StoreCleanupResult> {
  try {
    const user = await requirePermission("store.cleanup");
    const parsed = storeCleanupFiltersSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid filters" };
    }
    const f = parsed.data;
    const expected = storeCleanupExpectedSchema.safeParse(input);
    if (!expected.success) {
      return { ok: false, error: expected.error.issues[0]?.message ?? "Preview the impact before deleting." };
    }
    const { expectedRows } = expected.data;

    // Capture the span/total for the audit BEFORE deleting; bail if nothing matches.
    const preview = await previewStoreCleanup(f);
    if (preview.orders === 0) {
      return { ok: false, error: "No orders match that selection." };
    }
    if (preview.orders !== expectedRows) {
      return { ok: false, error: CLEANUP_SCOPE_CHANGED };
    }

    let deleted: number;
    try {
      deleted = await deleteStoreOrders(f, expectedRows);
    } catch (err) {
      if (err instanceof CleanupScopeChangedError) return { ok: false, error: err.message };
      throw err;
    }

    try {
      revalidatePath("/store/uploads");
      revalidatePath("/store/orders");
    } catch (err) {
      console.warn("revalidatePath after store cleanup failed:", err);
    }

    await logAudit({
      action: AUDIT_ACTIONS.STORE_BULK_DELETE,
      entityType: "store",
      entityId: null,
      entityLabel: `${deleted} order${deleted === 1 ? "" : "s"} deleted`,
      actorUserId: user.id,
      meta: {
        // Count the DELETE actually removed — not the (possibly stale) preview.
        deleted,
        sumTotal: preview.sumTotal,
        dateSpan: preview.from && preview.to ? `${preview.from} → ${preview.to}` : null,
        filters: {
          from: f.from ?? null,
          to: f.to ?? null,
          batchId: f.batchId ?? null,
          orderIds: f.orderIds,
        },
      },
    });

    return { ok: true, deleted };
  } catch (err) {
    return { ok: false, error: actionError(err, "store_cleanup") };
  }
}
