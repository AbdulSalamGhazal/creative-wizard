"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import { actionError } from "@/lib/action-error";
import { anchorBelongsToAccount } from "@/db/queries/comments";
import { openThread } from "@/db/queries/comment-reads";
import { listCommentsSchema } from "@/validators/comments";
import type { CommentAnchorType } from "@/lib/comments";

export interface ThreadOpenedResult {
  ok: boolean;
  error?: string;
  /** Where you left this thread before now (ISO), or null on a first visit. */
  previousReadAt?: string | null;
  /** How many of your comment notifications on it this marked read. */
  cleared?: number;
}

/**
 * The panel is SHOWING a thread (2026-10-20): snapshot where you left it, move
 * that to now, and mark your comment notifications on this anchor read — ONE
 * request, one transaction (`openThread`). Self-scoped (the session user is
 * the subject; there is no user id in the input) and account-scoped (the
 * active brand). The anchor is re-validated against the brand first, outside
 * the transaction, like every comment write. Not audited — read state, like
 * notification reads.
 */
export async function markThreadRead(input: unknown): Promise<ThreadOpenedResult> {
  try {
    const user = await requireAuth();
    const parsed = listCommentsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "That thread isn't valid." };
    const accountId = await getActiveAccountId();
    const anchorType = parsed.data.anchorType as CommentAnchorType;
    const { anchorId } = parsed.data;

    const anchor = await anchorBelongsToAccount(anchorType, anchorId, accountId);
    if (!anchor.ok) return { ok: false, error: "That thread isn't available." };

    const opened = await db.transaction((tx) =>
      openThread(tx, { userId: user.id, accountId, anchorType, anchorId }),
    );
    return {
      ok: true,
      previousReadAt: opened.previousReadAt?.toISOString() ?? null,
      cleared: opened.cleared,
    };
  } catch (err) {
    return { ok: false, error: actionError(err, "comment-reads") };
  }
}
