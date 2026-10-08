"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditEvents, commentReactions, comments } from "@/db/schema";
import { can, requireAuth } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { actionError } from "@/lib/action-error";
import {
  reactionEmoji,
  rootParentId,
  splitCommentRecipients,
  type CommentAnchorType,
} from "@/lib/comments";
import { createNotifications } from "@/db/queries/notifications";
import { COMMENT_EVENT_TYPES, categoryForType } from "@/lib/notifications";
import {
  anchorParticipants,
  anchorBelongsToAccount,
  getComment,
  resolveAnchorPath,
  insertMentions,
  mentionsOf,
  replaceMentions,
  lastCommentDeleter,
  threadParticipants,
} from "@/db/queries/comments";
import { brandMembers } from "@/db/queries/notifications";
import {
  createCommentSchema,
  deleteCommentSchema,
  restoreCommentSchema,
  toggleReactionSchema,
  updateCommentSchema,
} from "@/validators/comments";

/**
 * Comments — post, edit, delete.
 *
 * Three rules live here, and each is a security property rather than a
 * nicety:
 *
 *  - **The anchor is re-validated against the ACTIVE brand.** `anchor_id` has
 *    no foreign key (it addresses four different things), so the action looks
 *    the entity up account-scoped, and a `view` pathname must be on the
 *    allow-list. Another brand's campaign id is simply "not found".
 *  - **Mentions must be members of this brand.** A non-member is rejected out
 *    loud rather than silently dropped: silently posting a comment whose
 *    mention did nothing is worse than refusing it.
 *  - **Threads are flat.** Replying to a reply re-parents to the thread's root,
 *    server-side, so the shape can't be bent by a hand-made request.
 *
 * Creation is deliberately NOT audited — the comment is its own visible
 * record. Edits and deletes are, because they remove evidence.
 */

export interface CommentActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

function errMsg(err: unknown): string {
  return actionError(err, "comments");
}

/** The surfaces a comment can appear on — cheap, and keeps counts honest. */
function revalidateComments() {
  try {
    revalidatePath("/library", "layout");
    revalidatePath("/campaigns", "layout");
    revalidatePath("/budget");
  } catch (err) {
    console.warn("revalidatePath after comment change failed:", err);
  }
}

const BODY_SNAPSHOT = 200;

export async function createComment(input: unknown): Promise<CommentActionResult> {
  try {
    const user = await requireAuth();
    const parsed = createCommentSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid comment." };
    }
    const { anchorType, anchorId, viewQuery, body, mentionUserIds } = parsed.data;
    const acct = await getActiveAccountId();

    // The FK this column can't have.
    const anchor = await anchorBelongsToAccount(
      anchorType as CommentAnchorType,
      anchorId,
      acct,
    );
    if (!anchor.ok) return { ok: false, error: "That isn't something you can comment on." };

    // A mention that can't see this brand would notify someone about a thing
    // they cannot open. Refuse, don't drop.
    let mentioned: string[] = [];
    if (mentionUserIds.length > 0) {
      const members = new Set((await brandMembers()).map((m) => m.id));
      const outsiders = mentionUserIds.filter((id) => !members.has(id));
      if (outsiders.length > 0) {
        return { ok: false, error: "You can only mention people with access to this brand." };
      }
      mentioned = [...new Set(mentionUserIds)];
    }

    // Flat threads: a reply to a reply belongs to that reply's root.
    let parentId: string | null = null;
    if (parsed.data.parentId) {
      const target = await getComment(parsed.data.parentId, acct);
      if (!target) return { ok: false, error: "That comment no longer exists." };
      if (target.anchorType !== anchorType || target.anchorId !== anchorId) {
        return { ok: false, error: "That reply doesn't belong to this thread." };
      }
      parentId = rootParentId({ id: target.id, parentId: target.parentId });
    }

    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(comments)
        .values({
          accountId: acct,
          authorUserId: user.id,
          anchorType,
          anchorId,
          viewQuery: viewQuery ?? null,
          parentId,
          body,
        })
        .returning({ id: comments.id });
      const commentId = row!.id;
      await insertMentions(tx, commentId, mentioned);

      // Who hears about this, and how. A REPLY reaches its thread; a
      // TOP-LEVEL comment reaches everyone who has commented on this anchor
      // before (2026-10) — one bounded query, and only on the path that needs
      // it. Priority is mention > reply > anchor activity, one row per person.
      const participants = parentId
        ? await threadParticipants(tx, acct, parentId)
        : [];
      const followers = parentId
        ? []
        : await anchorParticipants(tx, acct, anchorType as CommentAnchorType, anchorId);
      const split = splitCommentRecipients({
        actorUserId: user.id,
        mentioned,
        participants,
        anchorParticipants: followers,
      });

      const href = `/go/comment/${commentId}`;
      const preview = body.length > 140 ? `${body.slice(0, 139)}…` : body;
      /**
       * The notification is stamped with the ANCHOR, not the comment: the
       * comment id already rides in the href, and stamping the anchor is what
       * lets /notifications group "5 updates on «Hero v2»" into one row.
       */
      const entity = { entityType: anchorType, entityId: anchorId };
      await createNotifications(tx, [
        ...split.mention.map((recipientUserId) => ({
          accountId: acct,
          recipientUserId,
          category: categoryForType(COMMENT_EVENT_TYPES.MENTION),
          type: COMMENT_EVENT_TYPES.MENTION,
          title: `${user.name} mentioned you on ${anchor.label}`,
          body: preview,
          href,
          actorUserId: user.id,
          ...entity,
        })),
        ...split.reply.map((recipientUserId) => ({
          accountId: acct,
          recipientUserId,
          category: categoryForType(COMMENT_EVENT_TYPES.REPLY),
          type: COMMENT_EVENT_TYPES.REPLY,
          title: `${user.name} replied on ${anchor.label}`,
          body: preview,
          href,
          actorUserId: user.id,
          ...entity,
        })),
        ...split.anchorActivity.map((recipientUserId) => ({
          accountId: acct,
          recipientUserId,
          category: categoryForType(COMMENT_EVENT_TYPES.ANCHOR_ACTIVITY),
          type: COMMENT_EVENT_TYPES.ANCHOR_ACTIVITY,
          title: `${user.name} commented on ${anchor.label} — where you commented`,
          body: preview,
          href,
          actorUserId: user.id,
          ...entity,
        })),
      ]);

      return commentId;
    });

    revalidateComments();
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

/** Edit your own comment. The "edited" marker is the only history kept. */
export async function updateComment(input: unknown): Promise<CommentActionResult> {
  try {
    const user = await requireAuth();
    const parsed = updateCommentSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid comment." };
    }
    const acct = await getActiveAccountId();
    const existing = await getComment(parsed.data.id, acct);
    if (!existing || existing.deletedAt) {
      return { ok: false, error: "That comment no longer exists." };
    }
    // Editing is AUTHOR-ONLY, admins included: putting words in someone's
    // mouth is different from removing them.
    if (existing.authorUserId !== user.id) {
      return { ok: false, error: "You can only edit your own comments." };
    }

    /**
     * AN EDIT CAN ADD A MENTION, and a mention that notifies nobody is a
     * broken promise — the picker said "Notifying Sara". So the edit diffs the
     * mention set and notifies the NEW names only, inside the same transaction
     * as the body write. Removing a mention drops its row (nothing highlights
     * any more) but RETRACTS NOTHING: you cannot un-tell someone.
     */
    const nextMentions = parsed.data.mentionUserIds;
    let added: string[] = [];
    if (nextMentions !== undefined) {
      const members = new Set((await brandMembers()).map((m) => m.id));
      const outsiders = nextMentions.filter((id) => !members.has(id));
      if (outsiders.length > 0) {
        return {
          ok: false,
          error: "You can only mention people with access to this brand.",
        };
      }
    }
    const anchor = await anchorBelongsToAccount(
      existing.anchorType as CommentAnchorType,
      existing.anchorId,
      acct,
    );

    await db.transaction(async (tx) => {
      await tx
        .update(comments)
        .set({ body: parsed.data.body, editedAt: new Date() })
        .where(and(eq(comments.id, parsed.data.id), eq(comments.accountId, acct)));

      if (nextMentions === undefined) return;
      const before = new Set(await mentionsOf(tx, parsed.data.id));
      const next = [...new Set(nextMentions)];
      await replaceMentions(tx, parsed.data.id, next);
      added = next.filter((id) => !before.has(id) && id !== user.id);
      if (added.length === 0 || !anchor.ok) return;

      const preview =
        parsed.data.body.length > 140
          ? `${parsed.data.body.slice(0, 139)}…`
          : parsed.data.body;
      await createNotifications(
        tx,
        added.map((recipientUserId) => ({
          accountId: acct,
          recipientUserId,
          category: categoryForType(COMMENT_EVENT_TYPES.MENTION),
          type: COMMENT_EVENT_TYPES.MENTION,
          title: `${user.name} mentioned you on ${anchor.label}`,
          body: preview,
          href: `/go/comment/${parsed.data.id}`,
          actorUserId: user.id,
          entityType: existing.anchorType,
          entityId: existing.anchorId,
        })),
      );
    });

    revalidateComments();
    await logAudit({
      action: AUDIT_ACTIONS.COMMENT_UPDATE,
      entityType: "comment",
      entityId: parsed.data.id,
      entityLabel: `${existing.anchorType}:${existing.anchorId}`,
      actorUserId: user.id,
      meta: {
        anchorType: existing.anchorType,
        anchorId: existing.anchorId,
        before: existing.body.slice(0, BODY_SNAPSHOT),
        after: parsed.data.body.slice(0, BODY_SNAPSHOT),
      },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

/**
 * Soft-delete: the row stays and renders as "Comment deleted", so the replies
 * under it still make sense. The author may delete their own; an admin may
 * delete anyone's (and the audit records which of the two it was).
 *
 * There is no confirm dialog — the UI offers an UNDO toast instead, backed by
 * `restoreComment`. That's safe precisely because the delete is soft.
 *
 * The audit row is written INSIDE this transaction rather than through the
 * fire-and-forget `logAudit`: it is not only the record, it is what
 * `restoreComment` reads to decide who may undo. A delete that committed
 * without its row would be a delete nobody could reverse.
 */
export async function deleteComment(input: unknown): Promise<CommentActionResult> {
  try {
    const user = await requireAuth();
    const parsed = deleteCommentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid comment." };
    const acct = await getActiveAccountId();
    const existing = await getComment(parsed.data.id, acct);
    if (!existing || existing.deletedAt) {
      return { ok: false, error: "That comment no longer exists." };
    }
    const isAuthor = existing.authorUserId === user.id;
    const isAdmin = can(user, "users.manage") || user.role === "admin";
    if (!isAuthor && !isAdmin) {
      return { ok: false, error: "You can only delete your own comments." };
    }

    const deleted = await db.transaction(async (tx) => {
      const rows = await tx
        .update(comments)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(comments.id, parsed.data.id),
            eq(comments.accountId, acct),
            isNull(comments.deletedAt),
          ),
        )
        .returning({ id: comments.id });
      // A concurrent delete got there first — nothing to record.
      if (rows.length === 0) return false;
      await tx.insert(auditEvents).values({
        accountId: acct,
        action: AUDIT_ACTIONS.COMMENT_DELETE,
        entityType: "comment",
        entityId: parsed.data.id,
        entityLabel: `${existing.anchorType}:${existing.anchorId}`,
        actorUserId: user.id,
        meta: {
          anchorType: existing.anchorType,
          anchorId: existing.anchorId,
          body: existing.body.slice(0, BODY_SNAPSHOT),
          // An admin clearing someone else's comment is a different act from
          // an author retracting their own.
          adminDeletedOther: !isAuthor,
          authorUserId: existing.authorUserId,
        },
      });
      return true;
    });
    if (!deleted) return { ok: false, error: "That comment no longer exists." };

    revalidateComments();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

/**
 * React to a comment, or take your reaction back — ONE action, because the two
 * are the same click. The unique key `(comment, user, kind)` IS the toggle: the
 * delete either removes the row or matches nothing, and only then do we insert.
 *
 * No permission beyond brand membership: whoever can read the thread and reply
 * to it can react to it. NOT audited, for the same reason notification reads
 * aren't — this is preference churn, and an audit log full of 👍 helps nobody.
 *
 * NOTIFYING IS ADD-ONLY, and goes to the comment's AUTHOR alone (the user's
 * decision: "like a reply"). Removing a reaction retracts nothing — you cannot
 * un-tell someone — and reacting to your own comment tells nobody.
 */
export async function toggleReaction(
  input: unknown,
): Promise<CommentActionResult & { reacted?: boolean }> {
  try {
    const user = await requireAuth();
    const parsed = toggleReactionSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "That reaction isn't available." };
    const acct = await getActiveAccountId();

    // The comment is re-validated ACCOUNT-SCOPED, like every other write here:
    // another brand's comment id is simply "not found".
    const comment = await getComment(parsed.data.commentId, acct);
    if (!comment) return { ok: false, error: "That comment no longer exists." };
    // A soft-deleted comment takes no new reactions — there is nothing left to
    // react to, and the UI hides the controls for the same reason.
    if (comment.deletedAt) return { ok: false, error: "That comment was deleted." };

    const { commentId, kind } = parsed.data;

    const reacted = await db.transaction(async (tx) => {
      const removed = await tx
        .delete(commentReactions)
        .where(
          and(
            eq(commentReactions.commentId, commentId),
            eq(commentReactions.userId, user.id),
            eq(commentReactions.kind, kind),
          ),
        )
        .returning({ id: commentReactions.id });
      if (removed.length > 0) return false;

      await tx.insert(commentReactions).values({
        commentId,
        userId: user.id,
        accountId: acct,
        kind,
      });

      // Reacting to your own comment notifies nobody, and an author whose row
      // is gone (deleted user) has nobody to notify either.
      if (!comment.authorUserId || comment.authorUserId === user.id) return true;

      const anchor = await resolveAnchorPath(
        comment.anchorType as CommentAnchorType,
        comment.anchorId,
        acct,
      );
      await createNotifications(tx, [
        {
          accountId: acct,
          recipientUserId: comment.authorUserId,
          category: categoryForType(COMMENT_EVENT_TYPES.REACTION),
          type: COMMENT_EVENT_TYPES.REACTION,
          title: `${user.name} reacted ${reactionEmoji(kind)} to your comment${
            anchor ? ` on ${anchor.label}` : ""
          }`,
          body: comment.body.length > 140 ? `${comment.body.slice(0, 139)}\u2026` : comment.body,
          href: `/go/comment/${commentId}`,
          actorUserId: user.id,
          // Stamped with the ANCHOR like every comment notification, so the
          // page can collapse a burst of reactions into one row.
          entityType: comment.anchorType,
          entityId: comment.anchorId,
        },
      ]);
      return true;
    });

    revalidateComments();
    return { ok: true, reacted };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

/**
 * Undo a delete. Permitted ONLY for whoever performed that delete — the author
 * who retracted their own comment, or the admin who removed someone else's —
 * checked server-side against the delete's audit row, never trusted from the
 * client. An author can't resurrect a comment an admin took down, and nobody
 * can restore a comment someone else deleted.
 *
 * The toast is the window: the UI offers this for ~8 seconds and then never
 * again. Nothing is lost after that — the row is soft-deleted, and a DB-level
 * rescue remains possible.
 */
export async function restoreComment(input: unknown): Promise<CommentActionResult> {
  try {
    const user = await requireAuth();
    const parsed = restoreCommentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid comment." };
    const acct = await getActiveAccountId();
    const existing = await getComment(parsed.data.id, acct);
    if (!existing) return { ok: false, error: "That comment no longer exists." };
    // Undo clicked twice, or already restored: the outcome the user wants.
    if (!existing.deletedAt) return { ok: true };

    const deleter = await lastCommentDeleter(db, parsed.data.id, acct);
    if (deleter !== user.id) {
      return {
        ok: false,
        error: "Only the person who deleted this comment can restore it.",
      };
    }

    const restored = await db.transaction(async (tx) => {
      const rows = await tx
        .update(comments)
        .set({ deletedAt: null })
        .where(
          and(
            eq(comments.id, parsed.data.id),
            eq(comments.accountId, acct),
            isNotNull(comments.deletedAt),
          ),
        )
        .returning({ id: comments.id });
      if (rows.length === 0) return false;
      await tx.insert(auditEvents).values({
        accountId: acct,
        action: AUDIT_ACTIONS.COMMENT_RESTORE,
        entityType: "comment",
        entityId: parsed.data.id,
        entityLabel: `${existing.anchorType}:${existing.anchorId}`,
        actorUserId: user.id,
        meta: {
          anchorType: existing.anchorType,
          anchorId: existing.anchorId,
          authorUserId: existing.authorUserId,
          restoredOwn: existing.authorUserId === user.id,
        },
      });
      return true;
    });

    revalidateComments();
    return restored ? { ok: true } : { ok: true };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}
