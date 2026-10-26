import { and, desc, eq, ilike, inArray, isNull, not, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, commentMentions, comments, creatives, users } from "@/db/schema";
import { auth, can } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import { NOTIFICATIONS_PAGE_SIZE } from "@/lib/notifications";
import {
  anchorPathFor,
  monthAnchorLabel,
  viewLabel,
  type CommentAnchorType,
} from "@/lib/comments";
import { refusedRoutes } from "@/lib/page-gates";
import type { ActivityParams } from "@/lib/activity";

/**
 * The Activity feed's read (2026-10): every live comment in the active brand,
 * newest first, server-paginated.
 *
 * Scope is the BRAND, like every comment read (`listComments` shows anyone
 * any anchor's thread) — with one subtraction: a comment on a page whose
 * PAGE refuses this viewer (`refusedRoutes`: Configuration, Team, Audit)
 * is left out, so no row leads to a 403. Deleted comments never appear;
 * the thread, which has to keep a deleted row's place, is the only surface
 * that shows one.
 */

export interface ActivityRow {
  id: string;
  parentId: string | null;
  /** The thread root's author when this is a reply — the "↳ Sara" marker. */
  parentAuthorName: string | null;
  authorUserId: string | null;
  /** Null when the author's account is gone — rendered "Former member". */
  authorName: string | null;
  authorAvatarUrl: string | null;
  body: string;
  editedAt: Date | null;
  createdAt: Date;
  anchorType: CommentAnchorType;
  anchorId: string;
  /**
   * The thing's CURRENT name (names change; nothing is stored), or null when
   * it is gone — a hard-deleted creative or campaign, a page the nav dropped.
   * A null label makes the row inert: there is nowhere to take the reader.
   */
  anchorLabel: string | null;
  anchorPath: string | null;
  /** Mentioned names, so the body highlights exactly as it does in its thread. */
  mentionNames: string[];
}

export interface ActivityResult {
  rows: ActivityRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listActivity(params: ActivityParams): Promise<ActivityResult> {
  const pageSize = NOTIFICATIONS_PAGE_SIZE;
  const page = Math.max(1, Math.floor(params.page));
  const empty: ActivityResult = { rows: [], total: 0, page, pageSize };

  // Resolved BEFORE any query — the session and the brand are never read
  // from inside a query's own flow.
  const user = await auth();
  if (!user) return empty;
  const acct = await getActiveAccountId();

  const filters = [eq(comments.accountId, acct), isNull(comments.deletedAt)];
  if (params.who === "me") filters.push(eq(comments.authorUserId, user.id));
  if (params.types.length > 0) filters.push(inArray(comments.anchorType, params.types));
  if (params.q) filters.push(ilike(comments.body, `%${params.q}%`));
  // The pages that would refuse this viewer — none for an admin, who passes
  // every gate. Only a `view` comment can sit on one.
  const refused = refusedRoutes((perm) => can(user, perm));
  if (refused.length > 0) {
    filters.push(
      not(and(eq(comments.anchorType, "view"), inArray(comments.anchorId, refused))!),
    );
  }
  const where = and(...filters);

  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: comments.id,
        parentId: comments.parentId,
        authorUserId: comments.authorUserId,
        authorName: users.name,
        authorAvatarUrl: users.avatarUrl,
        body: comments.body,
        editedAt: comments.editedAt,
        createdAt: comments.createdAt,
        anchorType: comments.anchorType,
        anchorId: comments.anchorId,
      })
      .from(comments)
      .leftJoin(users, eq(users.id, comments.authorUserId))
      .where(where)
      // The id breaks ties so two comments in the same millisecond can never
      // swap pages between one request and the next.
      .orderBy(desc(comments.createdAt), desc(comments.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(comments).where(where),
  ]);
  const total = count?.n ?? 0;
  if (rows.length === 0) return { ...empty, total };

  // FOUR bounded lookups for the page — never one per row (prod's pool is ONE
  // connection). `anchor_id` is text and entity ids are uuid: each lookup
  // takes only the ids of ITS anchor type, which the write path validated.
  const ids = rows.map((r) => r.id);
  const idsOf = (type: CommentAnchorType) =>
    [...new Set(rows.filter((r) => r.anchorType === type).map((r) => r.anchorId))];
  const creativeIds = idsOf("creative");
  const campaignIds = idsOf("campaign");
  const parentIds = [...new Set(rows.flatMap((r) => (r.parentId ? [r.parentId] : [])))];

  const [creativeRows, campaignRows, parentRows, mentionRows] = await Promise.all([
    creativeIds.length > 0
      ? db
          .select({ id: creatives.id, name: creatives.name })
          .from(creatives)
          .where(and(eq(creatives.accountId, acct), inArray(creatives.id, creativeIds)))
      : [],
    campaignIds.length > 0
      ? db
          .select({ id: campaigns.id, name: campaigns.name })
          .from(campaigns)
          .where(and(eq(campaigns.accountId, acct), inArray(campaigns.id, campaignIds)))
      : [],
    parentIds.length > 0
      ? db
          .select({ id: comments.id, name: users.name })
          .from(comments)
          .leftJoin(users, eq(users.id, comments.authorUserId))
          .where(and(eq(comments.accountId, acct), inArray(comments.id, parentIds)))
      : [],
    db
      .select({ commentId: commentMentions.commentId, name: users.name })
      .from(commentMentions)
      .leftJoin(users, eq(users.id, commentMentions.userId))
      .where(inArray(commentMentions.commentId, ids)),
  ]);

  const creativeName = new Map(creativeRows.map((r) => [r.id, r.name]));
  const campaignName = new Map(campaignRows.map((r) => [r.id, r.name]));
  const parentName = new Map(parentRows.map((r) => [r.id, r.name]));
  const mentionsOf = new Map<string, string[]>();
  for (const m of mentionRows) {
    if (m.name === null) continue;
    const list = mentionsOf.get(m.commentId) ?? [];
    list.push(m.name);
    mentionsOf.set(m.commentId, list);
  }

  const labelOf = (type: CommentAnchorType, id: string): string | null => {
    if (type === "creative") return creativeName.get(id) ?? null;
    if (type === "campaign") return campaignName.get(id) ?? null;
    if (type === "budget_month") return monthAnchorLabel(id);
    return viewLabel(id);
  };

  return {
    rows: rows.map((r) => {
      // The column holds only the vocabulary — `anchorTypeSchema` guards the
      // one write path — so the stored string IS a CommentAnchorType.
      const anchorType = r.anchorType as CommentAnchorType;
      const anchorLabel = labelOf(anchorType, r.anchorId);
      return {
        id: r.id,
        parentId: r.parentId,
        parentAuthorName: r.parentId ? (parentName.get(r.parentId) ?? null) : null,
        authorUserId: r.authorUserId,
        authorName: r.authorName,
        authorAvatarUrl: r.authorAvatarUrl,
        body: r.body,
        editedAt: r.editedAt,
        createdAt: r.createdAt,
        anchorType,
        anchorId: r.anchorId,
        anchorLabel,
        anchorPath:
          anchorLabel === null ? null : anchorPathFor(anchorType, r.anchorId, anchorLabel),
        mentionNames: mentionsOf.get(r.id) ?? [],
      };
    }),
    total,
    page,
    pageSize,
  };
}
