import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { listComments } from "@/db/queries/comments";
import { listCommentsSchema } from "@/validators/comments";
import type { CommentAnchorType } from "@/lib/comments";

export const dynamic = "force-dynamic";

/**
 * GET /api/comments?anchorType=&anchorId= — one anchor's thread, for the
 * aggregate pages' Comments sheet, which loads lazily when it opens (those
 * pages shouldn't pay for a thread nobody looked at).
 *
 * Behind `middleware.ts` like every other `/api` route; the anchor is validated
 * with the same schema the post path uses (a `view` anchor must be on the
 * allow-list), and the read is account-scoped in the query layer.
 */
export async function GET(request: NextRequest) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const parsed = listCommentsSchema.safeParse({
    anchorType: searchParams.get("anchorType") ?? "",
    anchorId: searchParams.get("anchorId") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid anchor" }, { status: 400 });
  }

  const rows = await listComments(
    parsed.data.anchorType as CommentAnchorType,
    parsed.data.anchorId,
  );
  return NextResponse.json(
    { comments: rows },
    { headers: { "Cache-Control": "no-store" } },
  );
}
