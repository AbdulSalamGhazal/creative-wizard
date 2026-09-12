"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { performanceRecords, uploadBatches } from "@/db/schema";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { getActiveAccountId } from "@/lib/tenant";
import { actionError } from "@/lib/action-error";
import { notifyRoutes } from "@/db/queries/notifications";
import { int } from "@/lib/format";

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
    const user = await requirePermission("upload.rollback");
    const acct = await getActiveAccountId();

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
      .where(and(eq(uploadBatches.accountId, acct), eq(uploadBatches.id, batchId)))
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

    const deleted = await db.transaction(async (tx) => {
      // Count what was ACTUALLY removed rather than trusting the batch's
      // recorded rowsImported — the two diverge whenever rows were deleted by
      // the cleanup tool or a creative/campaign delete after the import.
      const rows = await tx
        .delete(performanceRecords)
        .where(
          and(
            eq(performanceRecords.accountId, acct),
            eq(performanceRecords.uploadBatchId, batchId),
          ),
        )
        .returning({ id: performanceRecords.id });

      await tx
        .update(uploadBatches)
        .set({
          status: "rolled_back",
          rolledBackAt: new Date(),
          rolledBackByUserId: user.id,
        })
        .where(and(eq(uploadBatches.accountId, acct), eq(uploadBatches.id, batchId)));

      // Same transaction as the delete: if the rollback fails, nobody is told
      // it happened.
      await notifyRoutes(tx, acct, "upload.rolled_back", {
        title: `Upload rolled back: ${int(rows.length)} ${
          rows.length === 1 ? "row" : "rows"
        } removed`,
        body: batch.fileName,
        href: "/uploads",
        actorUserId: user.id,
        entity: { type: "upload", id: batchId },
      });
      return rows.length;
    });

    try {
      revalidatePath("/");
      revalidatePath("/library");
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
        rowsDeleted: deleted,
        uploadedAt: batch.uploadedAt,
      },
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, "rollback") };
  }
}
