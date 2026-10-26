"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useNavTransition } from "@/lib/nav-progress";
import {
  COMMENT_PARAM,
  deepLinkStep,
  markPostSent,
  monthAnchorLabel,
  settleSentPosts,
  stripCommentParam,
  viewLabel,
  type CommentAnchor,
} from "@/lib/comments";
import { useCommentAnchor } from "@/components/comments/comment-anchor-context";
import { anchorKeyOf, usePanel } from "@/components/comments/comment-panel";
import {
  CommentThread,
  type ThreadComment,
} from "@/components/comments/comment-thread";
import { CommentComposer } from "@/components/comments/comment-composer";
import { createComment } from "@/app/actions/comments";
import { markThreadRead, type ThreadOpenedResult } from "@/app/actions/comment-reads";
import { safeAction } from "@/lib/action-failure";
import { announceNotificationsChanged } from "@/lib/notifications";
import { InfoTip } from "@/components/ui/info-tip";
import { AVATAR_CHANGED_EVENT } from "@/lib/avatar-upload";
import type { CommentRow } from "@/db/queries/comments";

/**
 * The comment panel's BODY — the thread, the composer and everything they
 * draw. Loaded lazily (W2-8, 2026-10) by `CommentDock` in comment-panel.tsx,
 * which holds the shared state, the toggle and the dock's frame; preloaded on
 * idle so a first open doesn't wait for this module.
 */

/**
 * Drop `?comment=` from the address bar once the panel has shown it — so a
 * reload or Back doesn't re-run an old deep link, and the same notification
 * clicked again re-highlights (the param changes, so the opener fires). The
 * native History API: Next keeps `useSearchParams` in sync with it, and
 * nothing is fetched or re-rendered on the server for it. The other params
 * are kept verbatim.
 */
function forgetDeepLinkInUrl(): void {
  try {
    const { pathname, search, hash } = window.location;
    if (!new URLSearchParams(search).has(COMMENT_PARAM)) return;
    const rest = stripCommentParam(search);
    // `null` state, as Next documents: Next's patched replaceState then
    // carries its own internal state over AND applies the new URL to the
    // router, so `useSearchParams` stops seeing the param. (Passing the
    // current `history.state` marks the call as Next-internal, and the router
    // would keep the stale URL.)
    window.history.replaceState(null, "", `${pathname}${rest ? `?${rest}` : ""}${hash}`);
  } catch {
    /* a sandboxed frame without history access — the param just stays */
  }
}

const anchorParams = (anchor: CommentAnchor, extra?: Record<string, string>) =>
  new URLSearchParams({ anchorType: anchor.type, anchorId: anchor.id, ...extra }).toString();

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

export function CommentPanelBody({
  currentUserId,
  currentUserName,
  currentUserAvatarUrl,
  canModerate,
  onClose,
  inSheet,
}: {
  currentUserId: string | null;
  currentUserName: string | null;
  currentUserAvatarUrl: string | null;
  canModerate: boolean;
  onClose: () => void;
  /** The Sheet needs Radix's Title/Description for its dialog semantics. */
  inSheet: boolean;
}) {
  const anchor = useCommentAnchor();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startNav] = useNavTransition();
  const { highlightId, setHighlightId, deepLinkId, setDeepLinkId, setCount } = usePanel();
  const [rows, setRows] = useState<CommentRow[] | null>(null);
  /** The thread failed to load — say so and offer Retry, never "Loading…" forever. */
  const [loadFailed, setLoadFailed] = useState(false);
  /** The deep link this panel already reloaded once for (see `deepLinkStep`). */
  const reloadedFor = useRef<string | null>(null);
  /**
   * Your posts the stored thread doesn't show yet: `pending` while on their
   * way ("Sending…"), then — once the server has them — plain rows that stay
   * until a SUCCESSFUL load contains their id. A failed reload must never make
   * a sent comment vanish (2026-10-20 review).
   */
  const [pending, setPending] = useState<ThreadComment[]>([]);
  /** The comment Reply was clicked on (its thread root is where it lands). */
  const [replyTo, setReplyTo] = useState<{ rootId: string; comment: ThreadComment } | null>(
    null,
  );
  /** Where you last left this thread — the "New" divider's baseline. */
  const [newSince, setNewSince] = useState<Date | null>(null);
  const anchorKey = anchorKeyOf(anchor);

  /** Load the thread. Resolves `true` when the stored thread is on screen. */
  const load = useCallback(async (): Promise<boolean> => {
    if (!anchor) return false;
    try {
      const res = await fetch(`/api/comments?${anchorParams(anchor)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`comments ${res.status}`);
      const data = (await res.json()) as { comments: WireComment[] };
      const hydrated = hydrate(data.comments ?? []);
      setRows(hydrated);
      // A sent post leaves the local list only now that a stored copy is on
      // screen — same render, so it never blinks out or doubles up.
      const stored = new Set(hydrated.map((c) => c.id));
      setPending((list) => settleSentPosts(list, stored));
      setLoadFailed(false);
      setCount(hydrated.filter((c) => c.deletedAt === null).length);
      return true;
    } catch {
      // Keep whatever is on screen — sent posts included — and say so.
      setLoadFailed(true);
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey, setCount]);

  // A new page is a new conversation; the panel itself stays open. The
  // HIGHLIGHT goes with the old one: it points at a comment id that does not
  // exist in this thread, and the thread's scroll effect would then find
  // nothing to scroll to — leaving the new conversation parked at the top
  // instead of at its newest message.
  //
  // The DEEP LINK is deliberately not reset here — this runs on mount and
  // when an entity page registers its anchor, which is exactly when a deep
  // link is waiting for its thread.
  useEffect(() => {
    setRows(null);
    setLoadFailed(false);
    setPending([]);
    setReplyTo(null);
    setHighlightId(null);
    setNewSince(null);
    void load();
  }, [load, setHighlightId]);

  // Someone's photo changed: the thread was fetched with the old URLs.
  useEffect(() => {
    const reload = () => void load();
    window.addEventListener(AVATAR_CHANGED_EVENT, reload);
    return () => window.removeEventListener(AVATAR_CHANGED_EVENT, reload);
  }, [load]);

  // THE THREAD IS ON SCREEN (2026-10-20): one request snapshots where you
  // left it (the "New" baseline), moves that to now, and marks your comment
  // notifications on this anchor read — then the bell follows at once
  // (`NOTIFICATIONS_CHANGED_EVENT`, no second timer). Once per anchor while
  // the panel shows it; a failure just means no "New" divider this time.
  useEffect(() => {
    if (!anchor) return;
    let live = true;
    void (async () => {
      const res = await safeAction(() =>
        markThreadRead({ anchorType: anchor.type, anchorId: anchor.id }),
      );
      if (!live || !res.ok) return;
      const opened = res as ThreadOpenedResult;
      setNewSince(opened.previousReadAt ? new Date(opened.previousReadAt) : null);
      if ((opened.cleared ?? 0) > 0) announceNotificationsChanged("panel");
    })();
    return () => {
      live = false;
    };
    // `anchorKey` is the identity; `anchor` is a fresh object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey]);

  // A deep link waiting for its thread: highlight it once a loaded thread
  // contains it (then drop the param from the URL), or reload once if the
  // thread on screen predates the comment.
  useEffect(() => {
    const step = deepLinkStep({
      deepLinkId,
      loadedIds: rows ? rows.map((r) => r.id) : null,
      reloadedFor: reloadedFor.current,
    });
    if (step.kind === "highlight") {
      reloadedFor.current = null;
      setHighlightId(step.id);
      setDeepLinkId(null);
      forgetDeepLinkInUrl();
    } else if (step.kind === "reload") {
      reloadedFor.current = deepLinkId;
      void load();
    }
  }, [deepLinkId, rows, load, setHighlightId, setDeepLinkId]);

  const title = !anchor
    ? "Comments"
    : anchor.type === "view"
      ? `Comments on ${viewLabel(anchor.id) ?? "this page"}`
      : anchor.type === "budget_month"
        ? `Comments on ${monthAnchorLabel(anchor.id)}`
        : "Comments on this page";
  // A helper that matters, kept out of the body copy ("show, don't label"):
  // an ⓘ beside the title.
  const description = "Click a comment to put the page back the way its author saw it.";

  /**
   * Click-to-apply: the comment's saved view is applied to the page beside the
   * panel, which stays open. Clicking another comment switches the page to its
   * view instead — the panel becomes a set of saved states.
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
      <div className="flex items-start gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            {inSheet ? (
              <SheetTitle className="truncate text-sm">{title}</SheetTitle>
            ) : (
              <h2 className="truncate text-sm font-medium text-ink">{title}</h2>
            )}
            {anchor && <InfoTip label="How comments work">{description}</InfoTip>}
          </div>
          {/* The Sheet is a dialog: Radix wants its description — for screen
              readers only; sighted readers have the ⓘ. */}
          {inSheet && <SheetDescription className="sr-only">{description}</SheetDescription>}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={onClose}
          aria-label="Close comments"
          className="h-7 w-7 shrink-0 p-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {!anchor ? (
        // The panel persists across pages — on one with no thread it says so
        // quietly rather than vanishing out from under the reader.
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center">
          <p className="text-xs text-ink-3">
            Nothing to comment on here. Open another page to see its thread.
          </p>
          {/* The brand's feed is the other way to find a conversation
              (2026-10); the panel closes — its job here is done, and a row
              there reopens it on the comment it leads to. */}
          <Link href="/activity" onClick={onClose} className="text-xs text-brand hover:underline">
            See all activity
          </Link>
        </div>
      ) : (
        <>
          {/* Oldest at the top, newest at the bottom; the composer is pinned
              below, where the conversation ends. */}
          {/* `data-comment-scroll`: the thread reveals a comment by setting
              THIS box's scrollTop — never scrollIntoView, which would scroll
              the page beside the panel too (ui-system invariant). */}
          <div data-comment-scroll className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {rows === null && loadFailed ? (
              <div className="py-8 text-center text-xs text-ink-3">
                <p>Couldn&rsquo;t load comments</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="mt-1 text-brand"
                  onClick={() => {
                    setLoadFailed(false);
                    void load();
                  }}
                >
                  Retry
                </Button>
              </div>
            ) : rows === null ? (
              <p className="py-8 text-center text-xs text-ink-3">Loading…</p>
            ) : (
              <CommentThread
                comments={pending.length > 0 ? [...rows, ...pending] : rows}
                currentUserId={currentUserId}
                canModerate={canModerate}
                currentQuery={searchParams.toString()}
                highlightId={highlightId}
                newSince={newSince}
                onApplyView={applyView}
                onReply={(comment) =>
                  setReplyTo({ rootId: comment.parentId ?? comment.id, comment })
                }
                onChanged={() => void load()}
              />
            )}
          </div>

          {/* A REFRESH failed while a thread is on screen: what's shown may be
              stale (a sent post kept, others' new ones missing) — say so,
              quietly, with the way out. */}
          {rows !== null && loadFailed && (
            <div className="flex items-center justify-center gap-1 border-t border-line px-3 py-1.5 text-[11px] text-ink-3">
              <span>Couldn&rsquo;t load comments</span>
              <span aria-hidden>·</span>
              <button
                type="button"
                onClick={() => void load()}
                className="rounded text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
              >
                Retry
              </button>
            </div>
          )}

          <div className="border-t border-line px-3 py-3">
            {replyTo && (
              // "Replying to «Name»" with a one-line quote of THAT comment —
              // the quote in its own direction (an Arabic comment reads RTL
              // inside the English chip), names isolated.
              <div className="mb-2 flex items-start gap-2 rounded-md border-l-2 border-brand/60 bg-surface-2 py-1 pl-2 pr-1 text-[11px]">
                <div className="min-w-0 flex-1">
                  <div className="text-ink-2">
                    Replying to{" "}
                    <bdi className="font-medium text-ink">
                      {replyTo.comment.authorName ?? "Former member"}
                    </bdi>
                  </div>
                  <p dir="auto" className="truncate text-ink-3">
                    {replyTo.comment.body}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => setReplyTo(null)}
                  aria-label="Cancel reply"
                  className="h-5 w-5 shrink-0 p-0"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}
            <CommentComposer
              // A new key per reply target remounts the composer, and
              // `autoFocus` then puts the caret in it AT ONCE — clicking Reply
              // means "I'm about to type" (docked panel and phone Sheet alike).
              key={`${anchorKey}:${replyTo?.comment.id ?? "root"}`}
              autoFocus={replyTo !== null}
              placeholder={replyTo ? "Write a reply…" : "Write a comment… (@ to mention)"}
              rows={replyTo ? 2 : 3}
              submitLabel={replyTo ? "Reply" : "Post"}
              ariaLabel={replyTo ? "Write a reply" : "Write a comment"}
              // The VIEW is captured HERE, at submit time, from the LIVE
              // location — what the reader was looking at when they posted.
              onSubmit={async (body, mentionUserIds) => {
                // Shown in the thread AT ONCE, dimmed, until the reload brings
                // the stored row — a post took ~0.4 s to appear otherwise.
                const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                const drop = () => setPending((list) => list.filter((c) => c.id !== tempId));
                setPending((list) => [
                  ...list,
                  {
                    id: tempId,
                    parentId: replyTo?.rootId ?? null,
                    authorUserId: currentUserId,
                    authorName: currentUserName,
                    authorAvatarUrl: currentUserAvatarUrl,
                    body,
                    viewQuery: null,
                    editedAt: null,
                    deletedAt: null,
                    createdAt: new Date(),
                    mentions: [],
                    reactions: [],
                    pending: true,
                  },
                ]);
                try {
                  const res = await safeAction(() =>
                    createComment({
                      anchorType: anchor.type,
                      anchorId: anchor.id,
                      parentId: replyTo?.rootId ?? null,
                      body,
                      // Minus `?comment=`: a deep link's navigation is not part
                      // of what the reader was looking at (2026-10).
                      viewQuery:
                        typeof window === "undefined"
                          ? ""
                          : stripCommentParam(window.location.search),
                      mentionUserIds,
                    }),
                  );
                  // The composer clears as soon as the server has it. The row
                  // stops saying "Sending…" and takes the stored id; it stays
                  // until a load actually shows the stored copy — if the
                  // reload fails, it does NOT vanish.
                  if (res.ok) {
                    const storedId = res.id ?? tempId;
                    setPending((list) => markPostSent(list, tempId, storedId));
                    void load();
                  } else {
                    drop();
                  }
                  return res;
                } catch (err) {
                  drop();
                  throw err; // only a navigation signal gets here
                }
              }}
              onSubmitted={() => {
                setReplyTo(null);
                // Your own post is the newest thing in the thread, so land
                // there: a highlight left over from a deep link or a
                // click-to-apply would otherwise keep the thread scrolled to
                // somebody else's older comment.
                setHighlightId(null);
                setDeepLinkId(null);
                // The thread reloads itself (in onSubmit, above) — and ONLY
                // the thread. No router refresh: no server page reads
                // comments, so it was a second full re-render of the page
                // beside the panel (2026-10).
              }}
            />
          </div>
        </>
      )}
    </>
  );
}
