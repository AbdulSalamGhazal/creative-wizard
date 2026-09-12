"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MessageSquare, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useNavTransition } from "@/lib/nav-progress";
import { cn } from "@/lib/utils";
import {
  COMMENT_PARAM,
  monthAnchorLabel,
  viewLabel,
  type CommentAnchor,
} from "@/lib/comments";
import { useCommentAnchor } from "@/components/comments/comment-anchor-context";
import { CommentThread } from "@/components/comments/comment-thread";
import { CommentComposer } from "@/components/comments/comment-composer";
import type { CommentRow } from "@/db/queries/comments";

interface WireComment extends Omit<CommentRow, "createdAt" | "editedAt" | "deletedAt"> {
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

const hydrate = (rows: WireComment[]): CommentRow[] =>
  rows.map((c) => ({
    ...c,
    createdAt: new Date(c.createdAt),
    editedAt: c.editedAt ? new Date(c.editedAt) : null,
    deletedAt: c.deletedAt ? new Date(c.deletedAt) : null,
  }));

/**
 * The comment drawer — ONE surface for the whole app, in the top bar.
 *
 * It follows the page: an entity page's registered anchor, or the page itself
 * when it is nav-listed. A page with no anchor (a flow step, the notifications
 * feed) hides the icon rather than opening an empty drawer.
 *
 * The thread loads when the drawer opens, so a page nobody comments on costs
 * one small count request and nothing else.
 */
export function CommentDrawer({
  currentUserId,
  canModerate,
}: {
  currentUserId: string | null;
  canModerate: boolean;
}) {
  const anchor = useCommentAnchor();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startNav] = useNavTransition();

  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [rows, setRows] = useState<CommentRow[] | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const deepLinked = searchParams.get(COMMENT_PARAM);
  const currentQuery = searchParams.toString();
  const anchorKey = anchor ? `${anchor.type}:${anchor.id}` : null;

  const params = useCallback(
    (a: CommentAnchor, extra?: Record<string, string>) =>
      new URLSearchParams({ anchorType: a.type, anchorId: a.id, ...extra }).toString(),
    [],
  );

  /** The badge — one bounded COUNT per page, for the whole app. */
  useEffect(() => {
    if (!anchor) {
      setCount(0);
      return;
    }
    let live = true;
    void (async () => {
      try {
        const res = await fetch(`/api/comments?${params(anchor, { count: "1" })}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { count: number };
        if (live) setCount(data.count ?? 0);
      } catch {
        /* offline — the next page view tries again */
      }
    })();
    return () => {
      live = false;
    };
    // `anchorKey` is the identity that matters; `anchor` is a fresh object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey, params]);

  const load = useCallback(async () => {
    if (!anchor) return;
    try {
      const res = await fetch(`/api/comments?${params(anchor)}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { comments: WireComment[] };
      const hydrated = hydrate(data.comments ?? []);
      setRows(hydrated);
      setCount(hydrated.filter((c) => c.deletedAt === null).length);
    } catch {
      setRows([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey, params]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Arriving from a notification: the resolver lands with ?comment=<id>, so
  // the drawer opens on it with the saved view already applied to the page.
  useEffect(() => {
    if (!deepLinked) return;
    setOpen(true);
    setHighlightId(deepLinked);
  }, [deepLinked]);

  // A new page is a new conversation.
  useEffect(() => {
    setRows(null);
    setReplyTo(null);
  }, [anchorKey]);

  if (!anchor) return null;

  const title =
    anchor.type === "view"
      ? (viewLabel(anchor.id) ?? "this page")
      : anchor.type === "budget_month"
        ? monthAnchorLabel(anchor.id)
        : "this page";

  /**
   * Click-to-apply: the comment's saved view is applied to the page BEHIND the
   * drawer, which stays open. Clicking another comment switches the page to
   * its view instead — the drawer becomes a set of saved states.
   */
  const applyView = (comment: CommentRow) => {
    setHighlightId(comment.id);
    const query = comment.viewQuery ?? "";
    startNav(() =>
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }),
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={count > 0 ? `Comments — ${count}` : "Comments"}
        className="relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-line text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <MessageSquare className="h-4 w-4" />
        {count > 0 && (
          <span className="num absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-surface-2 px-1 text-[10px] leading-4 text-ink-2 ring-1 ring-line">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          // Full width on a phone; a column on anything larger.
          className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
        >
          <SheetHeader className="border-b border-line px-4 py-3">
            <SheetTitle className="text-sm">Comments on {title}</SheetTitle>
            <SheetDescription className="text-[11px]">
              Posting remembers the filters you have on screen. Click a comment to
              put the page back the way its author saw it.
            </SheetDescription>
          </SheetHeader>

          {/* Oldest at the top, newest at the bottom — the composer is pinned
              below, where the conversation ends. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {rows === null ? (
              <p className="py-8 text-center text-xs text-ink-3">Loading…</p>
            ) : (
              <CommentThread
                comments={rows}
                currentUserId={currentUserId}
                canModerate={canModerate}
                currentQuery={currentQuery}
                highlightId={highlightId}
                onApplyView={applyView}
                onReply={(rootId) => setReplyTo(rootId)}
                onChanged={() => void load()}
              />
            )}
          </div>

          <div className="border-t border-line px-3 py-3">
            {replyTo && (
              <div className="mb-2 flex items-center gap-2 text-[11px] text-ink-3">
                <span>Replying in this thread</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => setReplyTo(null)}
                  className={cn("h-5 px-1")}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}
            <CommentComposer
              key={replyTo ?? "root"}
              anchorType={anchor.type}
              anchorId={anchor.id}
              parentId={replyTo}
              placeholder={replyTo ? "Write a reply…" : "Write a comment…"}
              onPosted={() => {
                setReplyTo(null);
                void load();
              }}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
