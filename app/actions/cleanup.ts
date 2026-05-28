"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import {
  deleteRecords,
  previewCleanup,
  type CleanupPreview,
} from "@/db/queries/cleanup";
import { cleanupFiltersSchema } from "@/validators/cleanup";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";

export interface PreviewResult {
  ok: boolean;
  error?: string;
  preview?: CleanupPreview;
}

export interface CleanupResult {
  ok: boolean;
  error?: string;
  deleted?: number;
}

/**
 * Count + summarize what a cleanup selection would remove. Read-only,
 * admin-only. The UI calls this before showing the destructive confirm.
 */
export async function previewCleanupAction(
  input: unknown,
): Promise<PreviewResult> {
  try {
    await requireAdmin();
    const parsed = cleanupFiltersSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid filters" };
    }
    const preview = await previewCleanup(parsed.data);
    return { ok: true, preview };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Permanently delete the performance_records matching the selection.
 *
 * This is a sanctioned exit path for performance_records (alongside batch
 * rollback): admin-only, requires at least one filter, and writes an audit
 * entry recording the exact selection and the row count removed.
 */
export async function runCleanup(input: unknown): Promise<CleanupResult> {
  try {
    const user = await requireAdmin();
    const parsed = cleanupFiltersSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid filters" };
    }
    const f = parsed.data;

    // Capture the impact for the audit log before deleting.
    const preview = await previewCleanup(f);
    if (preview.rows === 0) {
      return { ok: false, error: "Nothing matches that selection." };
    }

    const deleted = await deleteRecords(f);

    try {
      revalidatePath("/");
      revalidatePath("/creatives");
      revalidatePath("/summary");
      revalidatePath("/uploads");
    } catch (err) {
      console.warn("revalidatePath after cleanup failed:", err);
    }

    await logAudit({
      action: AUDIT_ACTIONS.RECORDS_BULK_DELETE,
      entityType: "upload",
      entityId: null,
      entityLabel: `${deleted} record${deleted === 1 ? "" : "s"} deleted`,
      actorUserId: user.id,
      meta: {
        deleted,
        spend: preview.spend,
        creatives: preview.creatives,
        dateSpan: preview.from && preview.to ? `${preview.from} → ${preview.to}` : null,
        filters: {
          platforms: f.platforms,
          from: f.from ?? null,
          to: f.to ?? null,
          productIds: f.productIds,
          creativeIds: f.creativeIds,
        },
      },
    });

    return { ok: true, deleted };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
