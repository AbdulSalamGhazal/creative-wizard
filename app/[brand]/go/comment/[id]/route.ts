import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import { getComment, resolveAnchorPath } from "@/db/queries/comments";
import { buildCommentTarget, type CommentAnchorType } from "@/lib/comments";
import { activityCommentHref } from "@/lib/activity";
import { withBrand } from "@/lib/brand-path";

export const dynamic = "force-dynamic";

/**
 * GET /<brand>/go/comment/[id] — the deep-link resolver every comment
 * notification points at. Under the brand (2026-11): the comment is looked up
 * in the URL's brand, and every place it sends the reader stays in it.
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
  { params }: { params: Promise<{ brand: string; id: string }> },
) {
  const { brand, id } = await params;
  const to = (path: string) =>
    NextResponse.redirect(new URL(withBrand(decodeURIComponent(brand), path), _request.url));
  const user = await auth();
  if (!user) return NextResponse.redirect(new URL("/signin", _request.url));

  const acct = await getActiveAccountId();
  const comment = await getComment(id, acct);
  if (!comment) {
    // Wrong brand, deleted anchor, or a made-up id — all the same answer.
    return to("/notifications?missing=1");
  }

  // An old PAGE comment (retired 2026-11-07) has no page to open on: it is
  // read where it lives now, in "All comments", on its own.
  const anchor =
    comment.anchorType === "view"
      ? null
      : await resolveAnchorPath(comment.anchorType as CommentAnchorType, comment.anchorId, acct);
  const target = anchor
    ? buildCommentTarget(anchor.path, comment.viewQuery, comment.id)
    : null;
  if (!target) {
    // A page comment, or the thing it was about is gone (a deleted creative,
    // say): the comment itself survives, read-only, in "All comments".
    return to(activityCommentHref(comment.id));
  }

  return to(target);
}
