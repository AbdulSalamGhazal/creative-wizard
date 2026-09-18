"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { storeSourceMappings } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { storeSourceMappingSchema } from "@/validators/store";
import { actionError } from "@/lib/action-error";

/**
 * Config for the Store → Reconciliation SOURCE mapping (permission
 * `config.store`): each raw `utm_source` value → an ad platform, or "not an ad
 * platform". Explicit mapping only — never auto-matched. Audited as
 * `store.source_mapping_update`.
 *
 * The "which field is the source?" picker was RETIRED in 2026-09: the source is
 * always `utm_source` (a system-required field), so there is nothing to pick.
 * `accounts.store_source_field_key` is backfilled to it and no longer read.
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
    return { ok: false, error: actionError(err, "store_source") };
  }
}
