"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { comments } from "@/db/schema";
import { can, requireAuth } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { actionError } from "@/lib/action-error";
import {
  rootParentId,
  splitCommentRecipients,
  type CommentAnchorType,
} from "@/lib/comments";
import { createNotifications } from "@/db/queries/notifications";
import {
  anchorBelongsToAccount,
  getComment,
  insertMentions,
  threadParticipants,
} from "@/db/queries/comments";
import { brandMembers } from "@/db/queries/notifications";
import {
  createCommentSchema,
  deleteCommentSchema,
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

      // Who hears about this, and how. A top-level comment with no mentions
      // reaches nobody — commenting is not a way to page the team.
      const participants = parentId
        ? await threadParticipants(tx, acct, parentId)
        : [];
      const split = splitCommentRecipients({
        actorUserId: user.id,
        mentioned,
        participants,
      });

      const href = `/go/comment/${commentId}`;
      const preview = body.length > 140 ? `${body.slice(0, 139)}…` : body;
      await createNotifications(tx, [
        ...split.mention.map((recipientUserId) => ({
          accountId: acct,
          recipientUserId,
          category: "mention" as const,
          type: "comment.mention",
          title: `${user.name} mentioned you on ${anchor.label}`,
          body: preview,
          href,
          actorUserId: user.id,
          entityType: "comment",
          entityId: commentId,
        })),
        ...split.reply.map((recipientUserId) => ({
          accountId: acct,
          recipientUserId,
          category: "reply" as const,
          type: "comment.reply",
          title: `${user.name} replied on ${anchor.label}`,
          body: preview,
          href,
          actorUserId: user.id,
          entityType: "comment",
          entityId: commentId,
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

    await db
      .update(comments)
      .set({ body: parsed.data.body, editedAt: new Date() })
      .where(and(eq(comments.id, parsed.data.id), eq(comments.accountId, acct)));

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

    await db
      .update(comments)
      .set({ deletedAt: new Date() })
      .where(and(eq(comments.id, parsed.data.id), eq(comments.accountId, acct)));

    revalidateComments();
    await logAudit({
      action: AUDIT_ACTIONS.COMMENT_DELETE,
      entityType: "comment",
      entityId: parsed.data.id,
      entityLabel: `${existing.anchorType}:${existing.anchorId}`,
      actorUserId: user.id,
      meta: {
        anchorType: existing.anchorType,
        anchorId: existing.anchorId,
        body: existing.body.slice(0, BODY_SNAPSHOT),
        // An admin clearing someone else's comment is a different act from an
        // author retracting their own.
        adminDeletedOther: !isAuthor,
        authorUserId: existing.authorUserId,
      },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}
