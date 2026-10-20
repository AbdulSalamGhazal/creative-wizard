"use server";

import { and, eq, inArray, isNull, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import { actionError } from "@/lib/action-error";
import { notificationIdSchema, notificationIdsSchema } from "@/validators/notifications";

/**
 * Notification mutations — every one acts on the CALLER'S OWN rows only.
 *
 * There is no permission here on purpose: your own notifications are yours to
 * read and clear. The gate is the scope instead — `recipient_user_id = you` AND
 * `account_id = the active brand` on every statement, so another user's id
 * simply matches nothing. Nothing in this module hard-deletes: "clear" is
 * `archived_at`, and unarchive puts it back.
 */

export interface NotificationActionResult {
  ok: boolean;
  error?: string;
  /** How many rows the action touched (bulk actions). */
  affected?: number;
}

function errMsg(err: unknown): string {
  return actionError(err, "notifications");
}

/*
 * NO `revalidatePath` here (2026-10). The bell calls `markNotificationRead`
 * from EVERY page, and a revalidation inside a server action re-renders the
 * page the caller is on and ships it in the response — so each bell click
 * re-rendered whatever dashboard page was open, for nothing: `/notifications`
 * is `force-dynamic` (a visit always renders fresh), and when it IS the page
 * on screen it refreshes itself on `NOTIFICATIONS_CHANGED_EVENT`
 * (lib/notifications.ts), which the bell dispatches after a write.
 */

/** The scope every statement below runs under. */
async function scope() {
  const user = await requireAuth();
  return { userId: user.id, accountId: await getActiveAccountId() };
}

function mine(userId: string, accountId: string) {
  return and(
    eq(notifications.recipientUserId, userId),
    eq(notifications.accountId, accountId),
  );
}

export async function markNotificationRead(
  input: unknown,
): Promise<NotificationActionResult> {
  try {
    const parsed = notificationIdSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid notification." };
    const { userId, accountId } = await scope();
    const rows = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          mine(userId, accountId),
          eq(notifications.id, parsed.data.id),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id });
    return { ok: true, affected: rows.length };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

/**
 * "Opening the bell = seen" (user decision, 2026-10-20): mark read exactly the
 * unread ids the popover LISTED. Bounded (`BELL_UNREAD_CAP`), Zod-validated,
 * and self-scoped like every statement here — another person's id matches
 * nothing. Unread items beyond the cap were not shown, so they stay unread.
 */
export async function markNotificationsRead(
  input: unknown,
): Promise<NotificationActionResult> {
  try {
    const parsed = notificationIdsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid notifications." };
    const { userId, accountId } = await scope();
    const rows = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          mine(userId, accountId),
          inArray(notifications.id, parsed.data.ids),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id });
    return { ok: true, affected: rows.length };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

export async function markAllRead(): Promise<NotificationActionResult> {
  try {
    const { userId, accountId } = await scope();
    const rows = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          mine(userId, accountId),
          isNull(notifications.readAt),
          isNull(notifications.archivedAt),
        ),
      )
      .returning({ id: notifications.id });
    return { ok: true, affected: rows.length };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

/** "Clear" — archive, never delete. Reading it first also marks it read. */
export async function archiveNotification(
  input: unknown,
): Promise<NotificationActionResult> {
  try {
    const parsed = notificationIdSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid notification." };
    const { userId, accountId } = await scope();
    const now = new Date();
    const rows = await db
      .update(notifications)
      .set({ archivedAt: now, readAt: now })
      .where(
        and(
          mine(userId, accountId),
          eq(notifications.id, parsed.data.id),
          isNull(notifications.archivedAt),
        ),
      )
      .returning({ id: notifications.id });
    return { ok: true, affected: rows.length };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

/** Clear everything already read — the inbox-zero sweep. */
export async function archiveAllRead(): Promise<NotificationActionResult> {
  try {
    const { userId, accountId } = await scope();
    const rows = await db
      .update(notifications)
      .set({ archivedAt: new Date() })
      .where(
        and(
          mine(userId, accountId),
          isNotNull(notifications.readAt),
          isNull(notifications.archivedAt),
        ),
      )
      .returning({ id: notifications.id });
    return { ok: true, affected: rows.length };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

/** Put a cleared notification back in the list. Archive is always reversible. */
export async function unarchiveNotification(
  input: unknown,
): Promise<NotificationActionResult> {
  try {
    const parsed = notificationIdSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid notification." };
    const { userId, accountId } = await scope();
    const rows = await db
      .update(notifications)
      .set({ archivedAt: null })
      .where(
        and(
          mine(userId, accountId),
          eq(notifications.id, parsed.data.id),
          isNotNull(notifications.archivedAt),
        ),
      )
      .returning({ id: notifications.id });
    return { ok: true, affected: rows.length };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}
