"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { storeOrders, storeUploadBatches } from "@/db/schema";
import { can, requirePermission } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import {
  listStoreFields,
  existingStoreOrderIds,
  writeStoreBatch,
} from "@/db/queries/store";
import { parseStoreFile } from "@/store/parse";
import { runStorePipeline, type StoreParsedRow } from "@/store/pipeline";
import { type StoreValidationError } from "@/store/errors";
import type { StoreField } from "@/store/fields";

/**
 * Store-order upload flow — parallel to the ads pipeline, but a self-contained
 * server-action pair (no session table): the client VALIDATES a file, then, on
 * confirm, re-submits the SAME file to COMMIT (re-parsed + re-validated inside a
 * transaction). Files are ≤10MB. STRICTLY additive to `store_orders`; touches no
 * ads table. Rollback removes a batch's INSERTED rows only.
 */

const ROLLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

export type StoreUploadReport =
  | {
      ok: false;
      errors: StoreValidationError[];
      warnings: StoreValidationError[];
    }
  | {
      ok: true;
      summary: {
        total: number;
        newCount: number;
        updatedCount: number;
        upsert: boolean;
        ignoredColumns: string[];
      };
      warnings: StoreValidationError[];
    };

export type StoreCommitResult =
  | { ok: false; error: string; errors?: StoreValidationError[] }
  | { ok: true; rowsInserted: number; rowsUpdated: number; batchId: string };

interface FileInput {
  content: ArrayBuffer;
  byteLength: number;
  fileName: string;
  upsert: boolean;
}

/** Pull the File + upsert flag out of a FormData. */
async function readFile(formData: FormData): Promise<FileInput | null> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return null;
  const upsert = ["true", "1", "on"].includes(String(formData.get("upsert")));
  return {
    content: await file.arrayBuffer(),
    byteLength: file.size,
    fileName: file.name,
    upsert,
  };
}

/** Existing order_ids among those present in the file (best-effort light parse). */
async function existingIdsForFile(
  content: ArrayBuffer,
  fields: StoreField[],
): Promise<Set<string>> {
  const p = parseStoreFile({ content });
  if (!p.ok) return new Set();
  const orderIdField = fields.find((f) => f.key === "order_id");
  if (!orderIdField) return new Set();
  const lookup = new Map(p.header.map((h, i) => [h.trim().toLowerCase(), i] as const));
  let col: number | undefined;
  for (const acc of orderIdField.headers) {
    const idx = lookup.get(acc.trim().toLowerCase());
    if (idx !== undefined) {
      col = idx;
      break;
    }
  }
  if (col === undefined) return new Set();
  const ids = p.rows.map((r) => (r[col!] ?? "").trim()).filter(Boolean);
  return existingStoreOrderIds(ids);
}

/** Shared validate step (used by validate AND commit). */
async function validate(input: FileInput): Promise<
  | { ok: false; errors: StoreValidationError[]; warnings: StoreValidationError[] }
  | {
      ok: true;
      rows: StoreParsedRow[];
      newCount: number;
      updatedCount: number;
      ignoredColumns: string[];
      warnings: StoreValidationError[];
    }
> {
  const fields = await listStoreFields();
  const existing = await existingIdsForFile(input.content, fields);
  return runStorePipeline({
    content: input.content,
    byteLength: input.byteLength,
    fileName: input.fileName,
    fields,
    existingOrderIds: existing,
    upsert: input.upsert,
  });
}

/** Gate: uploading needs `store.upload`; upsert additionally needs `upload.upsert`. */
async function gate(upsert: boolean) {
  const me = await requirePermission("store.upload");
  if (upsert && !can(me, "upload.upsert")) {
    throw new Error("You don't have permission to use upsert mode.");
  }
  return me;
}

export async function validateStoreUpload(
  formData: FormData,
): Promise<StoreUploadReport> {
  try {
    const input = await readFile(formData);
    if (!input) return { ok: false, errors: [], warnings: [] };
    await gate(input.upsert);

    const res = await validate(input);
    if (!res.ok) return { ok: false, errors: res.errors, warnings: res.warnings };
    return {
      ok: true,
      summary: {
        total: res.rows.length,
        newCount: res.newCount,
        updatedCount: res.updatedCount,
        upsert: input.upsert,
        ignoredColumns: res.ignoredColumns,
      },
      warnings: res.warnings,
    };
  } catch (err) {
    return {
      ok: false,
      errors: [
        {
          code: "S002",
          severity: "FATAL",
          message: err instanceof Error ? err.message : "Upload failed.",
        },
      ],
      warnings: [],
    };
  }
}

export async function commitStoreUpload(
  formData: FormData,
): Promise<StoreCommitResult> {
  try {
    const input = await readFile(formData);
    if (!input) return { ok: false, error: "No file provided." };
    const me = await gate(input.upsert);
    const acct = await getActiveAccountId();

    const res = await validate(input);
    if (!res.ok) {
      return { ok: false, error: "The file no longer validates.", errors: res.errors };
    }

    const toWrite = (r: StoreParsedRow) => ({
      orderId: r.orderId,
      orderDate: r.orderDate,
      totalAmount: r.totalAmount,
      attributes: r.attributes,
    });
    const inserts = res.rows.filter((r) => !r.isUpdate).map(toWrite);
    const updates = res.rows.filter((r) => r.isUpdate).map(toWrite);

    const { batchId, rowsInserted, rowsUpdated } = await writeStoreBatch({
      accountId: acct,
      fileName: input.fileName,
      uploadedByUserId: me.id,
      upsert: input.upsert,
      inserts,
      updates,
    });

    try {
      revalidatePath("/store/uploads");
      revalidatePath("/store/orders");
    } catch (e) {
      console.warn("revalidatePath after store commit failed:", e);
    }
    await logAudit({
      action: AUDIT_ACTIONS.STORE_UPLOAD_COMMIT,
      entityType: "store",
      entityId: batchId,
      entityLabel: input.fileName,
      actorUserId: me.id,
      meta: {
        fileName: input.fileName,
        rowsInserted,
        rowsUpdated,
        upsert: input.upsert,
      },
    });

    return {
      ok: true,
      rowsInserted,
      rowsUpdated,
      batchId,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Commit failed." };
  }
}

export async function rollbackStoreBatch(
  batchId: unknown,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const me = await requirePermission("upload.rollback");
    const parsed = z.string().uuid().safeParse(batchId);
    if (!parsed.success) return { ok: false, error: "Invalid batch id" };
    const acct = await getActiveAccountId();

    const [batch] = await db
      .select({
        id: storeUploadBatches.id,
        fileName: storeUploadBatches.fileName,
        status: storeUploadBatches.status,
        uploadedAt: storeUploadBatches.uploadedAt,
      })
      .from(storeUploadBatches)
      .where(and(eq(storeUploadBatches.accountId, acct), eq(storeUploadBatches.id, parsed.data)))
      .limit(1);
    if (!batch) return { ok: false, error: "Batch not found." };
    if (batch.status !== "active") return { ok: false, error: "Batch already rolled back." };
    if (Date.now() - batch.uploadedAt.getTime() > ROLLBACK_WINDOW_MS) {
      return { ok: false, error: "Rollback window (24h) has passed." };
    }

    const deleted = await db.transaction(async (tx) => {
      // Deletes only rows this batch INSERTED — updated rows kept their original
      // batch id, so they survive (updates aren't rollback-able, same as ads).
      const rows = await tx
        .delete(storeOrders)
        .where(and(eq(storeOrders.accountId, acct), eq(storeOrders.uploadBatchId, parsed.data)))
        .returning({ id: storeOrders.id });
      await tx
        .update(storeUploadBatches)
        .set({ status: "rolled_back", rolledBackAt: new Date(), rolledBackByUserId: me.id })
        .where(eq(storeUploadBatches.id, parsed.data));
      return rows.length;
    });

    try {
      revalidatePath("/store/uploads");
      revalidatePath("/store/orders");
    } catch (e) {
      console.warn("revalidatePath after store rollback failed:", e);
    }
    await logAudit({
      action: AUDIT_ACTIONS.STORE_UPLOAD_ROLLBACK,
      entityType: "store",
      entityId: parsed.data,
      entityLabel: batch.fileName,
      actorUserId: me.id,
      meta: { rowsDeleted: deleted },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Rollback failed." };
  }
}
