"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { actionError } from "@/lib/action-error";
import { eventMeta, type EventType } from "@/lib/notifications";
import { brandMembers, replaceEventRoutes, routeRecipients } from "@/db/queries/notifications";
import { saveRoutesSchema } from "@/validators/notifications";

/**
 * Who receives which event, per brand — the one configurable part of the
 * notification spine. Gated by `notify.manage` (reading your OWN notifications
 * needs nothing) and audited with the before/after recipient sets, because a
 * quiet event is indistinguishable from a broken one unless the change is on
 * the record.
 */

export interface RoutesActionResult {
  ok: boolean;
  error?: string;
}

/** Replace one event type's recipients. An empty set is valid: nobody is told. */
export async function saveNotificationRoutes(
  input: unknown,
): Promise<RoutesActionResult> {
  try {
    const user = await requirePermission("notify.manage");
    const parsed = saveRoutesSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid routing." };
    }
    const eventType = parsed.data.eventType as EventType;
    const acct = await getActiveAccountId();

    // Only people who can SEE this brand can be routed in it — a stale id from
    // a since-revoked member would otherwise file notifications nobody reads.
    const members = new Set((await brandMembers()).map((m) => m.id));
    const userIds = parsed.data.userIds.filter((id) => members.has(id));
    if (userIds.length !== parsed.data.userIds.length) {
      return { ok: false, error: "Someone on that list can't see this brand." };
    }

    const before = (await routeRecipients())[eventType] ?? [];
    await db.transaction(async (tx) => {
      await replaceEventRoutes(tx, acct, eventType, userIds);
    });

    try {
      revalidatePath("/admin/catalog");
    } catch (err) {
      console.warn("revalidatePath after routing change failed:", err);
    }
    await logAudit({
      action: AUDIT_ACTIONS.NOTIFY_ROUTES_UPDATE,
      entityType: "notification",
      entityId: eventType,
      entityLabel: eventMeta(eventType)?.label ?? eventType,
      actorUserId: user.id,
      meta: {
        eventType,
        from: [...before].sort(),
        to: [...userIds].sort(),
      },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, "notificationRoutes") };
  }
}
