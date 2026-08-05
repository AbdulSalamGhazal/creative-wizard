"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, storeSourceMappings } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import { listStoreFields } from "@/db/queries/store";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import {
  storeSourceFieldSchema,
  storeSourceMappingSchema,
} from "@/validators/store";

/**
 * Config for the Store → Reconciliation source mapping (permission
 * `config.store`). Picks which custom store field holds an order's traffic
 * source, and maps each raw source value to an ad platform (or "not an ad
 * platform"). Explicit mapping only — never auto-matched. Audited as
 * `store.source_mapping_update`.
 */

export interface SourceConfigResult {
  ok: boolean;
  error?: string;
}

function revalidateSafe() {
  try {
    revalidatePath("/admin/catalog");
    revalidatePath("/store/reconciliation");
  } catch (err) {
    console.warn("revalidatePath after source-mapping change failed:", err);
  }
}

/** Set (or clear, with null) the account's reconciliation source field. */
export async function setStoreSourceField(
  input: unknown,
): Promise<SourceConfigResult> {
  try {
    const me = await requirePermission("config.store");
    const parsed = storeSourceFieldSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const acct = await getActiveAccountId();
    const { fieldKey } = parsed.data;

    // A source field must be one of THIS account's custom (non-core) fields.
    if (fieldKey !== null) {
      const fields = await listStoreFields();
      const ok = fields.some((f) => !f.core && f.key === fieldKey);
      if (!ok) return { ok: false, error: "That field doesn't exist." };
    }

    await db
      .update(accounts)
      .set({ storeSourceFieldKey: fieldKey })
      .where(eq(accounts.id, acct));

    revalidateSafe();
    await logAudit({
      action: AUDIT_ACTIONS.STORE_SOURCE_MAPPING_UPDATE,
      entityType: "store",
      actorUserId: me.id,
      meta: { op: "set_field", fieldKey },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/** Assign a raw source value to a platform / "not an ad platform" / unmapped. */
export async function setStoreSourceMapping(
  input: unknown,
): Promise<SourceConfigResult> {
  try {
    const me = await requirePermission("config.store");
    const parsed = storeSourceMappingSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const acct = await getActiveAccountId();
    const { rawValue, assignment } = parsed.data;

    if (assignment === "unset") {
      // Delete the row → the value returns to Unmapped (Unattributed).
      await db
        .delete(storeSourceMappings)
        .where(
          and(
            eq(storeSourceMappings.accountId, acct),
            eq(storeSourceMappings.rawValue, rawValue),
          ),
        );
    } else {
      // "none" → an explicit "not an ad platform" row (platform NULL); a platform
      // key → that platform. Upsert on the unique (account_id, raw_value).
      const platform = assignment === "none" ? null : assignment;
      await db
        .insert(storeSourceMappings)
        .values({ accountId: acct, rawValue, platform })
        .onConflictDoUpdate({
          target: [storeSourceMappings.accountId, storeSourceMappings.rawValue],
          set: { platform, updatedAt: new Date() },
        });
    }

    revalidateSafe();
    await logAudit({
      action: AUDIT_ACTIONS.STORE_SOURCE_MAPPING_UPDATE,
      entityType: "store",
      actorUserId: me.id,
      meta: { op: "map_value", rawValue, assignment },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
