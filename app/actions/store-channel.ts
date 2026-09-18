"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { storeChannelMappings } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { storeChannelMappingSchema } from "@/validators/store";
import { actionError } from "@/lib/action-error";

/**
 * Config for the Store → Reconciliation CHANNEL mapping (permission
 * `config.store`) — the second axis beside utm_source → platform. Each raw
 * channel value is mapped EXPLICITLY to Website or Application; nothing is ever
 * auto-matched, and an unmapped value stays in its own visible bucket.
 * Audited as `store.source_mapping_update` with `axis: "channel"`.
 */

export interface ChannelConfigResult {
  ok: boolean;
  error?: string;
}

function revalidateSafe() {
  try {
    revalidatePath("/store/uploads");
    revalidatePath("/store/reconciliation");
  } catch (err) {
    console.warn("revalidatePath after channel-mapping change failed:", err);
  }
}

/** Map a raw channel value to Website / Application, or unset it. */
export async function setStoreChannelMapping(
  input: unknown,
): Promise<ChannelConfigResult> {
  try {
    const me = await requirePermission("config.store");
    const parsed = storeChannelMappingSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const acct = await getActiveAccountId();
    const { rawValue, assignment } = parsed.data;

    if (assignment === "unset") {
      // Delete the row → the value returns to the Unmapped bucket.
      await db
        .delete(storeChannelMappings)
        .where(
          and(
            eq(storeChannelMappings.accountId, acct),
            eq(storeChannelMappings.rawValue, rawValue),
          ),
        );
    } else {
      await db
        .insert(storeChannelMappings)
        .values({ accountId: acct, rawValue, destination: assignment })
        .onConflictDoUpdate({
          target: [storeChannelMappings.accountId, storeChannelMappings.rawValue],
          set: { destination: assignment, updatedAt: new Date() },
        });
    }

    revalidateSafe();
    await logAudit({
      action: AUDIT_ACTIONS.STORE_SOURCE_MAPPING_UPDATE,
      entityType: "store",
      actorUserId: me.id,
      meta: { axis: "channel", rawValue, assignment },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, "store_channel") };
  }
}
