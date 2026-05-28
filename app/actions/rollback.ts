"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { performanceRecords, uploadBatches } from "@/db/schema";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";

const ROLLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface RollbackResult {
  ok: boolean;
  error?: string;
}

/**
 * Roll back an upload batch. Admin only. Within 24h of the batch's
 * `uploaded_at`. Deletes every `performance_records` row for the batch and
 * flips the batch's status to `rolled_back` with the user + timestamp.
 *
 * Beyond 24h, returns an error — admins must operate on the DB directly per
 * the validation spec §8.
 */
export async function rollbackBatch(batchId: string): Promise<RollbackResult> {
  try {
    const user = await requireAdmin();

    const [batch] = await db
      .select({
        id: uploadBatches.id,
        uploadedAt: uploadBatches.uploadedAt,
        status: uploadBatches.status,
        platform: uploadBatches.platform,
        fileName: uploadBatches.fileName,
        rowsImported: uploadBatches.rowsImported,
      })
      .from(uploadBatches)
      .where(eq(uploadBatches.id, batchId))
      .limit(1);

    if (!batch) return { ok: false, error: "Batch not found." };
    if (batch.status !== "active") {
      return { ok: false, error: "Batch is not active." };
    }
    if (Date.now() - batch.uploadedAt.getTime() > ROLLBACK_WINDOW_MS) {
      return {
        ok: false,
        error: "Rollback window (24 h) has elapsed for this batch.",
      };
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(performanceRecords)
        .where(eq(performanceRecords.uploadBatchId, batchId));

      await tx
        .update(uploadBatches)
        .set({
          status: "rolled_back",
          rolledBackAt: new Date(),
          rolledBackByUserId: user.id,
        })
        .where(eq(uploadBatches.id, batchId));
    });

    try {
      revalidatePath("/");
      revalidatePath("/creatives");
      revalidatePath("/uploads");
    } catch (err) {
      console.warn("revalidatePath after rollback failed:", err);
    }

    await logAudit({
      action: AUDIT_ACTIONS.UPLOAD_ROLLBACK,
      entityType: "upload",
      entityId: batchId,
      entityLabel: batch.fileName,
      actorUserId: user.id,
      meta: {
        platform: batch.platform,
        rowsDeleted: batch.rowsImported,
        uploadedAt: batch.uploadedAt,
      },
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
