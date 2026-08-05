"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import { storeOrderFields } from "@/db/schema";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { isCoreKey, slugifyKey } from "@/store/fields";

/**
 * Admin config for store-order fields (`config.store`). CORE fields
 * (order_id/order_date/total_amount) are locked: only their label + accepted
 * `headers` are editable — never their key/type/required, and they can't be
 * deleted. Deleting a CUSTOM field stops it validating/displaying but KEEPS the
 * values already stored in `store_orders.attributes` (they're just orphaned).
 */

export interface FieldMutationResult {
  ok: boolean;
  error?: string;
}

const headersSchema = z.array(z.string().trim().min(1).max(255)).max(20);

const createSchema = z.object({
  label: z.string().trim().min(1, "Label is required.").max(64),
  type: z.enum(["text", "number", "date"]),
  required: z.boolean().default(false),
  headers: headersSchema.default([]),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(64).optional(),
  required: z.boolean().optional(),
  headers: headersSchema.optional(),
});

async function audit(userId: string, meta: Record<string, unknown>) {
  await logAudit({
    action: AUDIT_ACTIONS.STORE_FIELDS_UPDATE,
    entityType: "store",
    actorUserId: userId,
    meta,
  });
}

export async function createStoreField(input: unknown): Promise<FieldMutationResult> {
  try {
    const me = await requirePermission("config.store");
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const acct = await getActiveAccountId();
    const { label, type, required, headers } = parsed.data;

    // Auto-slug the key; ensure it's unique per account (and never collides with a core key).
    const base = slugifyKey(label);
    if (isCoreKey(base)) {
      return { ok: false, error: "That name collides with a system field. Pick another." };
    }
    const existing = new Set(
      (
        await db
          .select({ key: storeOrderFields.key })
          .from(storeOrderFields)
          .where(eq(storeOrderFields.accountId, acct))
      ).map((r) => r.key),
    );
    let key = base;
    let n = 2;
    while (existing.has(key)) key = `${base}_${n++}`.slice(0, 48);

    const [{ max } = { max: 0 }] = await db
      .select({ max: sql<number>`COALESCE(MAX(${storeOrderFields.sortOrder}), 0)` })
      .from(storeOrderFields)
      .where(eq(storeOrderFields.accountId, acct));

    await db.insert(storeOrderFields).values({
      accountId: acct,
      key,
      label,
      type,
      required,
      headers,
      sortOrder: (max ?? 0) + 1,
    });

    revalidatePathsSafe();
    await audit(me.id, { op: "create", key, label, type, required });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function updateStoreField(input: unknown): Promise<FieldMutationResult> {
  try {
    const me = await requirePermission("config.store");
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const acct = await getActiveAccountId();
    const { id, label, required, headers } = parsed.data;

    const [row] = await db
      .select({ key: storeOrderFields.key })
      .from(storeOrderFields)
      .where(and(eq(storeOrderFields.accountId, acct), eq(storeOrderFields.id, id)))
      .limit(1);
    if (!row) return { ok: false, error: "Field not found." };
    const core = isCoreKey(row.key);

    // Core fields: only label + headers are editable (key/type/required locked).
    const set: Partial<typeof storeOrderFields.$inferInsert> = { updatedAt: new Date() };
    if (label !== undefined) set.label = label;
    if (headers !== undefined) set.headers = headers;
    if (!core && required !== undefined) set.required = required;
    await db
      .update(storeOrderFields)
      .set(set)
      .where(and(eq(storeOrderFields.accountId, acct), eq(storeOrderFields.id, id)));

    revalidatePathsSafe();
    await audit(me.id, { op: "update", key: row.key, core });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function deleteStoreField(id: unknown): Promise<FieldMutationResult> {
  try {
    const me = await requirePermission("config.store");
    const parsed = z.string().uuid().safeParse(id);
    if (!parsed.success) return { ok: false, error: "Invalid field id" };
    const acct = await getActiveAccountId();

    const [row] = await db
      .select({ key: storeOrderFields.key })
      .from(storeOrderFields)
      .where(and(eq(storeOrderFields.accountId, acct), eq(storeOrderFields.id, parsed.data)))
      .limit(1);
    if (!row) return { ok: false, error: "Field not found." };
    if (isCoreKey(row.key)) {
      return { ok: false, error: "System fields can't be deleted." };
    }

    await db
      .delete(storeOrderFields)
      .where(and(eq(storeOrderFields.accountId, acct), eq(storeOrderFields.id, parsed.data)));

    revalidatePathsSafe();
    await audit(me.id, { op: "delete", key: row.key });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

function revalidatePathsSafe() {
  try {
    revalidatePath("/admin/catalog");
    revalidatePath("/store/orders");
  } catch (err) {
    console.warn("revalidatePath after store field mutation failed:", err);
  }
}
