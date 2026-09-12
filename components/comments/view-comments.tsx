import { auth, can } from "@/lib/auth";
import { commentCount } from "@/db/queries/comments";
import { CommentSheet } from "@/components/comments/comment-sheet";
import { isCommentableView } from "@/lib/comments";

/**
 * The header slot for an allow-listed aggregate page: one bounded COUNT query
 * server-side (so the badge is right on first paint), and the thread itself
 * loads only if someone opens the sheet.
 */
export async function ViewComments({ path }: { path: string }) {
  if (!isCommentableView(path)) return null;
  const [user, count] = await Promise.all([auth(), commentCount("view", path)]);
  return (
    <CommentSheet
      count={count}
      currentUserId={user?.id ?? null}
      canModerate={user ? user.role === "admin" || can(user, "users.manage") : false}
    />
  );
}
