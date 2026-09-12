import { and, desc, eq, ilike, inArray, isNull, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { notificationRoutes, notifications, userAccounts, users } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import {
  BELL_RECENT_LIMIT,
  NOTIFICATIONS_PAGE_SIZE,
  categoryForType,
  type EventType,
  type NotificationCategory,
} from "@/lib/notifications";

/** `db` or an open transaction — producers always pass their own `tx`. */
type Exec = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Notification reads and writes.
 *
 * THE RULE OF THIS MODULE: every read and every mutation of `notifications` is
 * scoped to `recipient_user_id = the session user` AND `account_id = the active
 * brand`. An id alone never identifies a row to act on — a notification is
 * personal, so someone else's id must simply match nothing rather than 403.
 */

/** The signed-in user + active brand, as every self-scoped query needs them. */
async function self(): Promise<{ userId: string; accountId: string } | null> {
  const user = await auth();
  if (!user) return null;
  return { userId: user.id, accountId: await getActiveAccountId() };
}

/** The scope predicate. Nothing in this file reads a row without it. */
function mine(userId: string, accountId: string) {
  return and(
    eq(notifications.recipientUserId, userId),
    eq(notifications.accountId, accountId),
  );
}

export interface NotificationRow {
  id: string;
  category: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  actorName: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
}

const ROW = {
  id: notifications.id,
  category: notifications.category,
  type: notifications.type,
  title: notifications.title,
  body: notifications.body,
  href: notifications.href,
  actorName: users.name,
  entityType: notifications.entityType,
  entityId: notifications.entityId,
  readAt: notifications.readAt,
  archivedAt: notifications.archivedAt,
  createdAt: notifications.createdAt,
};

// ── Producer side ───────────────────────────────────────────────────────────

export interface NewNotification {
  accountId: string;
  recipientUserId: string;
  category: NotificationCategory;
  type: string;
  title: string;
  body?: string | null;
  href?: string | null;
  actorUserId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}

/**
 * Insert notifications. ONE statement whatever the recipient count — producers
 * run inside the transaction of the thing they describe, and `lib/db.ts` holds
 * a single connection, so a round-trip per recipient would serialize.
 */
export async function createNotifications(
  tx: Exec,
  rows: NewNotification[],
): Promise<number> {
  if (rows.length === 0) return 0;
  await tx.insert(notifications).values(
    rows.map((r) => ({
      accountId: r.accountId,
      recipientUserId: r.recipientUserId,
      category: r.category,
      type: r.type,
      title: r.title,
      body: r.body ?? null,
      href: r.href ?? null,
      actorUserId: r.actorUserId ?? null,
      entityType: r.entityType ?? null,
      entityId: r.entityId ?? null,
    })),
  );
  return rows.length;
}

export interface NotifyInput {
  title: string;
  body?: string | null;
  href?: string | null;
  /** The person who caused it — deliberately EXCLUDED from the recipients. */
  actorUserId?: string | null;
  entity?: { type: string; id: string } | null;
}

/**
 * Fan an event out to its configured recipients, inside the caller's
 * transaction — so the notification and the write it describes commit or roll
 * back together.
 *
 * TWO queries: read the routes, insert the rows. No routes (or only the actor
 * routed) → nothing is written and nothing is logged: silence is the
 * configured outcome, not a failure.
 */
export async function notifyRoutes(
  tx: Exec,
  accountId: string,
  eventType: EventType,
  input: NotifyInput,
): Promise<number> {
  const routed = await tx
    .select({ userId: notificationRoutes.userId })
    .from(notificationRoutes)
    .where(
      and(
        eq(notificationRoutes.accountId, accountId),
        eq(notificationRoutes.eventType, eventType),
      ),
    );

  // You don't get told about the thing you just did.
  const recipients = [
    ...new Set(
      routed.map((r) => r.userId).filter((id) => id !== (input.actorUserId ?? null)),
    ),
  ];
  if (recipients.length === 0) return 0;

  return createNotifications(
    tx,
    recipients.map((recipientUserId) => ({
      accountId,
      recipientUserId,
      category: categoryForType(eventType),
      type: eventType,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      actorUserId: input.actorUserId ?? null,
      entityType: input.entity?.type ?? null,
      entityId: input.entity?.id ?? null,
    })),
  );
}

/**
 * A DIRECT notification: one known recipient, no routing to consult (see
 * `DIRECT_EVENT_TYPES`). Still inside the caller's transaction.
 */
export async function notifyUser(
  tx: Exec,
  row: NewNotification,
): Promise<number> {
  // Nobody needs to be told about something they did to themselves.
  if (row.recipientUserId === row.actorUserId) return 0;
  return createNotifications(tx, [row]);
}

// ── Reader side (always self-scoped) ────────────────────────────────────────

/** Unread, unarchived, for this user in this brand — served by the partial index. */
export async function unreadCount(): Promise<number> {
  const who = await self();
  if (!who) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        mine(who.userId, who.accountId),
        isNull(notifications.readAt),
        isNull(notifications.archivedAt),
      ),
    );
  return row?.n ?? 0;
}

/** The bell's popover: the newest few, archived ones excluded. */
export async function recentNotifications(
  limit = BELL_RECENT_LIMIT,
): Promise<NotificationRow[]> {
  const who = await self();
  if (!who) return [];
  return db
    .select(ROW)
    .from(notifications)
    .leftJoin(users, eq(users.id, notifications.actorUserId))
    .where(and(mine(who.userId, who.accountId), isNull(notifications.archivedAt)))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export type NotificationTab = "all" | "unread" | "archived";

export interface NotificationListResult {
  rows: NotificationRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Unread in the CURRENT tab's scope — drives the "Mark all read" affordance. */
  unread: number;
}

/**
 * The /notifications list — server-paginated, never an unbounded read.
 *
 * Archived rows are hidden from All and Unread and fully searchable in
 * Archived: "clear" is a move, not a delete, so the row has to remain findable.
 */
export async function listNotifications(opts: {
  tab: NotificationTab;
  categories?: string[];
  q?: string;
  page?: number;
}): Promise<NotificationListResult> {
  const pageSize = NOTIFICATIONS_PAGE_SIZE;
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const who = await self();
  if (!who) return { rows: [], total: 0, page, pageSize, unread: 0 };

  const filters = [mine(who.userId, who.accountId)];
  if (opts.tab === "archived") filters.push(isNotNull(notifications.archivedAt));
  else filters.push(isNull(notifications.archivedAt));
  if (opts.tab === "unread") filters.push(isNull(notifications.readAt));
  if (opts.categories && opts.categories.length > 0) {
    filters.push(inArray(notifications.category, opts.categories));
  }
  const q = opts.q?.trim();
  if (q) {
    const like = `%${q}%`;
    filters.push(
      or(ilike(notifications.title, like), ilike(notifications.body, like))!,
    );
  }
  const where = and(...filters);

  const [rows, [count], [unread]] = await Promise.all([
    db
      .select(ROW)
      .from(notifications)
      .leftJoin(users, eq(users.id, notifications.actorUserId))
      .where(where)
      .orderBy(desc(notifications.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(where),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          mine(who.userId, who.accountId),
          isNull(notifications.readAt),
          isNull(notifications.archivedAt),
        ),
      ),
  ]);

  return {
    rows,
    total: count?.n ?? 0,
    page,
    pageSize,
    unread: unread?.n ?? 0,
  };
}

// ── Routing config ──────────────────────────────────────────────────────────

/** Every configured route in the active brand, as eventType → user ids. */
export async function routeRecipients(): Promise<Record<string, string[]>> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      eventType: notificationRoutes.eventType,
      userId: notificationRoutes.userId,
    })
    .from(notificationRoutes)
    .where(eq(notificationRoutes.accountId, acct));
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[r.eventType] ??= []).push(r.userId);
  return out;
}

export interface BrandMember {
  id: string;
  name: string;
  email: string;
  role: string;
}

/**
 * Everyone who can SEE the active brand, and is therefore routable in it:
 * admins (always all-brands), all-brands users, and the members listed in
 * `user_accounts`. Mirrors `lib/account-access.ts` — membership says WHERE.
 */
export async function brandMembers(): Promise<BrandMember[]> {
  const acct = await getActiveAccountId();
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
    })
    .from(users)
    .where(
      or(
        eq(users.role, "admin"),
        eq(users.allAccounts, true),
        inArray(
          users.id,
          db
            .select({ id: userAccounts.userId })
            .from(userAccounts)
            .where(eq(userAccounts.accountId, acct)),
        ),
      ),
    )
    .orderBy(users.name);
}

/**
 * Replace one event's recipients in one brand. Delete-then-insert inside the
 * caller's transaction, so a save is all-or-nothing and the unique index can
 * never see a half-applied set.
 */
export async function replaceEventRoutes(
  tx: Exec,
  accountId: string,
  eventType: EventType,
  userIds: string[],
): Promise<void> {
  await tx
    .delete(notificationRoutes)
    .where(
      and(
        eq(notificationRoutes.accountId, accountId),
        eq(notificationRoutes.eventType, eventType),
      ),
    );
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  await tx
    .insert(notificationRoutes)
    .values(unique.map((userId) => ({ accountId, eventType, userId })));
}
