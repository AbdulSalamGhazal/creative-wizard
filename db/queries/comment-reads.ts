import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { commentReads, notifications } from "@/db/schema";
import { COMMENT_EVENT_TYPES } from "@/lib/notifications";
import type { CommentAnchorType } from "@/lib/comments";

/** `db` or an open transaction — the writer below always gets the caller's `tx`. */
type Exec = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

const COMMENT_TYPES = Object.values(COMMENT_EVENT_TYPES) as string[];

/**
 * A person OPENED a thread (2026-10-20): three statements, one transaction,
 * all self- AND account-scoped.
 *
 *  1. read where they left it — the SNAPSHOT the panel draws "New" from;
 *  2. move it to now (upsert on the unique index — a race keeps one row);
 *  3. mark THEIR unread comment notifications for this anchor read (user
 *     decision: a thread on screen has been seen). Comment notifications are
 *     stamped with the ANCHOR (`entity_type`/`entity_id`), which is what lets
 *     one update find them; the partial `notifications_unread_entity_idx`
 *     serves it.
 *
 * Every read here goes through `exec` — production's pool is ONE connection,
 * and a `db` query inside the caller's transaction would deadlock it.
 */
export async function openThread(
  exec: Exec,
  input: {
    userId: string;
    accountId: string;
    anchorType: CommentAnchorType;
    anchorId: string;
  },
): Promise<{ previousReadAt: Date | null; cleared: number }> {
  const { userId, accountId, anchorType, anchorId } = input;
  const [before] = await exec
    .select({ lastReadAt: commentReads.lastReadAt })
    .from(commentReads)
    .where(
      and(
        eq(commentReads.userId, userId),
        eq(commentReads.accountId, accountId),
        eq(commentReads.anchorType, anchorType),
        eq(commentReads.anchorId, anchorId),
      ),
    )
    .limit(1);

  await exec
    .insert(commentReads)
    .values({ userId, accountId, anchorType, anchorId, lastReadAt: sql`now()` })
    .onConflictDoUpdate({
      target: [
        commentReads.userId,
        commentReads.accountId,
        commentReads.anchorType,
        commentReads.anchorId,
      ],
      set: { lastReadAt: sql`now()` },
    });

  const cleared = await exec
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(
      and(
        eq(notifications.recipientUserId, userId),
        eq(notifications.accountId, accountId),
        eq(notifications.entityType, anchorType),
        eq(notifications.entityId, anchorId),
        isNull(notifications.readAt),
        inArray(notifications.type, COMMENT_TYPES),
      ),
    )
    .returning({ id: notifications.id });

  return { previousReadAt: before?.lastReadAt ?? null, cleared: cleared.length };
}
