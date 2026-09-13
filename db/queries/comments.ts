import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditEvents,
  campaigns,
  commentMentions,
  comments,
  creatives,
  users,
} from "@/db/schema";
import { getActiveAccountId } from "@/lib/tenant";
import {
  COMMENT_THREAD_LIMIT,
  monthAnchorLabel,
  viewLabel,
  type CommentAnchorType,
} from "@/lib/comments";

/** `db` or an open transaction — writers always pass their own `tx`. */
type Exec = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Comment reads. Every one is account-scoped, like every other tenant query;
 * `anchor_id` has no FK, so the WRITE side re-validates the anchor against the
 * active account (see app/actions/comments.ts) and the read side simply never
 * crosses brands.
 */

export interface CommentRow {
  id: string;
  parentId: string | null;
  authorUserId: string | null;
  /** Null when the author's account is gone — rendered "Former member". */
  authorName: string | null;
  body: string;
  viewQuery: string | null;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  /** Explicitly mentioned users, for highlighting and for the reply set. */
  mentions: Array<{ userId: string; name: string | null }>;
}

/**
 * One anchor's conversation: the newest `COMMENT_THREAD_LIMIT` top-level
 * comments and every reply under them, oldest-first within each thread.
 *
 * THREE bounded queries — the thread ids, the comments, the mentions — never a
 * query per thread (`lib/db.ts` is `max: 1`).
 */
export async function listComments(
  anchorType: CommentAnchorType,
  anchorId: string,
): Promise<CommentRow[]> {
  const acct = await getActiveAccountId();
  const anchored = and(
    eq(comments.accountId, acct),
    eq(comments.anchorType, anchorType),
    eq(comments.anchorId, anchorId),
  );

  const roots = await db
    .select({ id: comments.id })
    .from(comments)
    .where(and(anchored, isNull(comments.parentId)))
    .orderBy(desc(comments.createdAt))
    .limit(COMMENT_THREAD_LIMIT);
  if (roots.length === 0) return [];

  const rootIds = roots.map((r) => r.id);
  const rows = await db
    .select({
      id: comments.id,
      parentId: comments.parentId,
      authorUserId: comments.authorUserId,
      authorName: users.name,
      body: comments.body,
      viewQuery: comments.viewQuery,
      editedAt: comments.editedAt,
      deletedAt: comments.deletedAt,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .leftJoin(users, eq(users.id, comments.authorUserId))
    .where(
      and(
        anchored,
        or(inArray(comments.id, rootIds), inArray(comments.parentId, rootIds)),
      ),
    )
    .orderBy(asc(comments.createdAt));

  const mentionRows = await db
    .select({
      commentId: commentMentions.commentId,
      userId: commentMentions.userId,
      name: users.name,
    })
    .from(commentMentions)
    .leftJoin(users, eq(users.id, commentMentions.userId))
    .where(
      inArray(
        commentMentions.commentId,
        rows.map((r) => r.id),
      ),
    );

  const byComment = new Map<string, Array<{ userId: string; name: string | null }>>();
  for (const m of mentionRows) {
    const list = byComment.get(m.commentId) ?? [];
    list.push({ userId: m.userId, name: m.name });
    byComment.set(m.commentId, list);
  }

  return rows.map((r) => ({ ...r, mentions: byComment.get(r.id) ?? [] }));
}

/** How many live comments an anchor carries — the header button's badge. */
export async function commentCount(
  anchorType: CommentAnchorType,
  anchorId: string,
): Promise<number> {
  const acct = await getActiveAccountId();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(comments)
    .where(
      and(
        eq(comments.accountId, acct),
        eq(comments.anchorType, anchorType),
        eq(comments.anchorId, anchorId),
        isNull(comments.deletedAt),
      ),
    );
  return row?.n ?? 0;
}

/** One comment, account-scoped. Used by edit/delete and the /go resolver. */
export async function getComment(id: string, accountId: string, exec: Exec = db) {
  const [row] = await exec
    .select({
      id: comments.id,
      accountId: comments.accountId,
      authorUserId: comments.authorUserId,
      anchorType: comments.anchorType,
      anchorId: comments.anchorId,
      viewQuery: comments.viewQuery,
      parentId: comments.parentId,
      body: comments.body,
      deletedAt: comments.deletedAt,
    })
    .from(comments)
    .where(and(eq(comments.id, id), eq(comments.accountId, accountId)))
    .limit(1);
  return row ?? null;
}

/**
 * Everyone already party to a thread: its root author, everyone who replied,
 * and everyone mentioned anywhere in it. TWO queries, both keyed on the root.
 */
export async function threadParticipants(
  exec: Exec,
  accountId: string,
  rootId: string,
): Promise<string[]> {
  const rows = await exec
    .select({ id: comments.id, authorUserId: comments.authorUserId })
    .from(comments)
    .where(
      and(
        eq(comments.accountId, accountId),
        or(eq(comments.id, rootId), eq(comments.parentId, rootId)),
      ),
    );
  if (rows.length === 0) return [];

  const mentioned = await exec
    .select({ userId: commentMentions.userId })
    .from(commentMentions)
    .where(
      inArray(
        commentMentions.commentId,
        rows.map((r) => r.id),
      ),
    );

  return [
    ...new Set(
      [
        ...rows.map((r) => r.authorUserId),
        ...mentioned.map((m) => m.userId),
      ].filter((id): id is string => id !== null),
    ),
  ];
}

/**
 * The CURRENT path of what a comment is about — looked up at click time, which
 * is the whole reason the `/go/comment/[id]` resolver exists: creatives and
 * campaigns are addressed by NAME, and a rename would rot a stored link.
 */
export async function resolveAnchorPath(
  anchorType: CommentAnchorType,
  anchorId: string,
  accountId: string,
): Promise<{ path: string; label: string } | null> {
  if (anchorType === "view") {
    const label = viewLabel(anchorId);
    return label ? { path: anchorId, label } : null;
  }
  if (anchorType === "budget_month") {
    return {
      path: `/budget?month=${anchorId}`,
      label: monthAnchorLabel(anchorId),
    };
  }
  if (anchorType === "creative") {
    const [row] = await db
      .select({ name: creatives.name })
      .from(creatives)
      .where(and(eq(creatives.id, anchorId), eq(creatives.accountId, accountId)))
      .limit(1);
    if (!row) return null;
    return { path: `/library/${encodeURIComponent(row.name)}`, label: row.name };
  }
  const [row] = await db
    .select({ name: campaigns.name })
    .from(campaigns)
    .where(and(eq(campaigns.id, anchorId), eq(campaigns.accountId, accountId)))
    .limit(1);
  if (!row) return null;
  return { path: `/campaigns/${encodeURIComponent(row.name)}`, label: row.name };
}

/** Does this anchor exist IN THIS BRAND? The FK the column can't have. */
export async function anchorBelongsToAccount(
  anchorType: CommentAnchorType,
  anchorId: string,
  accountId: string,
): Promise<{ ok: true; label: string } | { ok: false }> {
  const resolved = await resolveAnchorPath(anchorType, anchorId, accountId);
  return resolved ? { ok: true, label: resolved.label } : { ok: false };
}

/** Insert a comment's mention rows. One statement, or none. */
export async function insertMentions(
  tx: Exec,
  commentId: string,
  userIds: string[],
): Promise<void> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  await tx
    .insert(commentMentions)
    .values(unique.map((userId) => ({ commentId, userId })));
}

/**
 * Who performed the MOST RECENT delete of a comment, from the audit trail.
 *
 * `comments` records THAT a comment was deleted, not who did it — and no
 * column was added for that. The delete action instead writes its audit row
 * INSIDE the delete's own transaction, which makes the audit trail a reliable
 * answer here: a committed delete always has its row, and the latest row wins
 * (delete → restore → someone else deletes = that someone).
 */
export async function lastCommentDeleter(
  exec: Exec,
  commentId: string,
  accountId: string,
): Promise<string | null> {
  const [row] = await exec
    .select({ actorUserId: auditEvents.actorUserId })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.accountId, accountId),
        eq(auditEvents.entityType, "comment"),
        eq(auditEvents.entityId, commentId),
        eq(auditEvents.action, "comment.delete"),
      ),
    )
    .orderBy(desc(auditEvents.id))
    .limit(1);
  return row?.actorUserId ?? null;
}
