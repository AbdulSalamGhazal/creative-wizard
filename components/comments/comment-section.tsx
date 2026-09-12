import { Suspense } from "react";
import { auth, can } from "@/lib/auth";
import { listComments } from "@/db/queries/comments";
import { CommentPanel } from "@/components/comments/comment-panel";
import type { CommentAnchorType } from "@/lib/comments";

/**
 * The on-page comments block for ENTITY surfaces (creative, campaign, budget
 * month). Server-rendered with the page, so the conversation is there on load
 * rather than after a spinner.
 *
 * Deliberately distinct from the creative's Notes: notes are a document one
 * person maintains, comments are a conversation several people have. Both stay.
 */
export async function CommentSection({
  anchorType,
  anchorId,
  title = "Comments",
  description,
}: {
  anchorType: CommentAnchorType;
  anchorId: string;
  title?: string;
  description?: string;
}) {
  const [user, rows] = await Promise.all([auth(), listComments(anchorType, anchorId)]);
  const live = rows.filter((r) => r.deletedAt === null).length;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-ink">
          {title}
          {live > 0 && <span className="ml-2 num text-[11px] text-ink-3">{live}</span>}
        </h2>
        <p className="text-[11px] text-ink-3">
          {description ??
            "Only mentions and replies notify anyone. Each comment remembers the filters it was written under."}
        </p>
      </div>
      <Suspense fallback={null}>
        <CommentPanel
          anchorType={anchorType}
          anchorId={anchorId}
          comments={rows}
          currentUserId={user?.id ?? null}
          canModerate={user ? user.role === "admin" || can(user, "users.manage") : false}
        />
      </Suspense>
    </section>
  );
}
