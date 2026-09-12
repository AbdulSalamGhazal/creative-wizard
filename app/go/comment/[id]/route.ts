import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import { getComment, resolveAnchorPath } from "@/db/queries/comments";
import { buildCommentTarget, type CommentAnchorType } from "@/lib/comments";

export const dynamic = "force-dynamic";

/**
 * GET /go/comment/[id] — the deep-link resolver every comment notification
 * points at.
 *
 * It exists because creatives and campaigns are addressed by NAME: a stored
 * `/library/Old-Name` link rots the moment someone renames the creative. This
 * looks the anchor up at CLICK time, so links never go stale, and appends the
 * view the comment was written in plus `?comment=<id>` — which the global
 * drawer reads, opening itself on that comment with its view already applied.
 * The reader lands on exactly what the commenter was looking at.
 *
 * Behind `middleware.ts` (session required); the lookup is account-scoped, so a
 * link to another brand's comment resolves to nothing rather than leaking that
 * the comment exists.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await auth();
  if (!user) return NextResponse.redirect(new URL("/signin", _request.url));

  const acct = await getActiveAccountId();
  const comment = await getComment(id, acct);
  if (!comment) {
    // Wrong brand, deleted anchor, or a made-up id — all the same answer.
    return NextResponse.redirect(new URL("/notifications?missing=1", _request.url));
  }

  const anchor = await resolveAnchorPath(
    comment.anchorType as CommentAnchorType,
    comment.anchorId,
    acct,
  );
  const target = anchor
    ? buildCommentTarget(anchor.path, comment.viewQuery, comment.id)
    : null;
  if (!target) {
    // The thing it was about is gone (a deleted creative, say).
    return NextResponse.redirect(new URL("/notifications?missing=1", _request.url));
  }

  return NextResponse.redirect(new URL(target, _request.url));
}
