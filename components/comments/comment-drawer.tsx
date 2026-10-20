"use client";

import {
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MessageSquare, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useNavTransition } from "@/lib/nav-progress";
import { cn } from "@/lib/utils";
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
import {
  CommentThread,
  type ThreadComment,
} from "@/components/comments/comment-thread";
import { CommentComposer } from "@/components/comments/comment-composer";
import { createComment } from "@/app/actions/comments";
import type { CommentRow } from "@/db/queries/comments";

/**
 * The comment panel — ONE surface for the whole app, DOCKED beside the page.
 *
 * It is not a modal. On a desktop the page SQUEEZES to make room and stays
 * fully visible and fully interactive: no backdrop, no focus trap, no scroll
 * lock, and clicking the page doesn't close it. That is what makes
 * click-to-apply-view work — you click a comment, the page behind it re-filters,
 * and you can keep reading both. It lives in the dashboard layout, so it
 * PERSISTS across navigation and simply shows the next page's thread.
 *
 * Three pieces share one state: the provider (layout), the toggle (top bar) and
 * the dock (beside the page).
 */

const OPEN_KEY = "cw-comments-open";

/** Tailwind's `lg`. Below it there's no room to squeeze — see CommentDock. */
const DOCK_QUERY = "(min-width: 1024px)";

interface PanelState {
  open: boolean;
  setOpen: (open: boolean) => void;
  highlightId: string | null;
  setHighlightId: (id: string | null) => void;
  /**
   * A comment a notification linked to (`?comment=<id>`) that is not on
   * screen yet. Kept APART from the highlight so the panel's resets (mount,
   * anchor registration) can't wipe it; it becomes the highlight once a
   * loaded thread contains it — `deepLinkStep` (2026-10).
   */
  deepLinkId: string | null;
  setDeepLinkId: (id: string | null) => void;
  /** Live comments on the current anchor — the toggle's badge. */
  count: number;
  setCount: (count: number) => void;
}

const PanelContext = createContext<PanelState | null>(null);

function usePanel(): PanelState {
  const value = useContext(PanelContext);
  if (!value) throw new Error("usePanel must be used inside <CommentPanelProvider>");
  return value;
}

export function CommentPanelProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpenState] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [deepLinkId, setDeepLinkId] = useState<string | null>(null);
  const [count, setCount] = useState(0);

  // Open/closed is a per-browser convenience that survives reloads; the server
  // never needs to know. Read after mount so there's no hydration mismatch.
  useEffect(() => {
    try {
      if (localStorage.getItem(OPEN_KEY) === "1") setOpenState(true);
    } catch {
      /* private mode — start closed */
    }
  }, []);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<PanelState>(
    () => ({
      open,
      setOpen,
      highlightId,
      setHighlightId,
      deepLinkId,
      setDeepLinkId,
      count,
      setCount,
    }),
    [open, setOpen, highlightId, deepLinkId, count],
  );

  return (
    <PanelContext.Provider value={value}>
      {children}
      {/* Suspense: reading ?comment= needs useSearchParams, and that must not
          suspend the whole dashboard. */}
      <Suspense fallback={null}>
        <DeepLinkOpener />
      </Suspense>
    </PanelContext.Provider>
  );
}

/**
 * Arriving from a notification: `/go/comment/[id]` lands with ?comment=<id>,
 * so the panel opens on that comment, highlighted, with its view applied.
 *
 * It only REGISTERS the deep link. Writing the id straight into the highlight
 * (as this did until 2026-10) lost it: the panel body's "new conversation"
 * reset cleared it when the panel mounted after opening, and again when the
 * entity page registered its anchor (null → creative). The body turns the
 * deep link into the highlight once its thread is loaded — `deepLinkStep`.
 */
function DeepLinkOpener() {
  const searchParams = useSearchParams();
  const { setOpen, setDeepLinkId } = usePanel();
  const id = searchParams.get(COMMENT_PARAM);
  useEffect(() => {
    if (!id) return;
    setOpen(true);
    setDeepLinkId(id);
  }, [id, setOpen, setDeepLinkId]);
  return null;
}

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

const anchorKeyOf = (anchor: CommentAnchor | null) =>
  anchor ? `${anchor.type}:${anchor.id}` : null;

const anchorParams = (anchor: CommentAnchor, extra?: Record<string, string>) =>
  new URLSearchParams({ anchorType: anchor.type, anchorId: anchor.id, ...extra }).toString();

/**
 * The top-bar icon. It TOGGLES the panel (the panel's own X closes it too) and
 * stays visible everywhere — the panel persists across pages, so the control
 * for it can't disappear on a page that has no thread.
 */
export function CommentToggle() {
  const anchor = useCommentAnchor();
  const { open, setOpen, count, setCount } = usePanel();
  const anchorKey = anchorKeyOf(anchor);

  // One bounded COUNT per page view, for the whole app.
  useEffect(() => {
    if (!anchor) {
      setCount(0);
      return;
    }
    let live = true;
    void (async () => {
      try {
        const res = await fetch(`/api/comments?${anchorParams(anchor, { count: "1" })}`, {
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
  }, [anchorKey, setCount]);

  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-pressed={open}
      aria-label={count > 0 ? `Comments — ${count}` : "Comments"}
      className={cn(
        "relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-line text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink",
        open && "bg-surface-2 text-ink",
      )}
    >
      <MessageSquare className="h-4 w-4" />
      {count > 0 && (
        <span className="num absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-surface-2 px-1 text-[10px] leading-4 text-ink-2 ring-1 ring-line">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </button>
  );
}

/** Whether the viewport can dock the panel. `null` until mounted. */
function useCanDock(): boolean | null {
  const [canDock, setCanDock] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia(DOCK_QUERY);
    const sync = () => setCanDock(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return canDock;
}

/**
 * Where the panel renders. Placed in the layout's content ROW, after the page
 * column (which is `flex-1 min-w-0`), so opening it squeezes the page rather
 * than covering it.
 *
 * BELOW `lg` it falls back to the full-width overlay Sheet: a phone has no room
 * to squeeze, and a 380px column beside a 375px page would crush the page to
 * nothing. On those widths the modal trade-off is the right one.
 */
export function CommentDock({
  currentUserId,
  currentUserName,
  canModerate,
}: {
  currentUserId: string | null;
  /** Your name, for the row a post shows while it is still on its way. */
  currentUserName: string | null;
  canModerate: boolean;
}) {
  const { open, setOpen } = usePanel();
  const canDock = useCanDock();

  if (!open || canDock === null) return null;

  if (canDock) {
    return (
      <aside
        aria-label="Comments"
        // Sticky under the 3.5rem top bar with its OWN scroll, so the panel
        // stays put while the page scrolls beside it.
        className="sticky top-14 flex h-[calc(100vh-3.5rem)] w-[380px] shrink-0 flex-col self-start border-l border-line bg-surface"
      >
        <CommentPanelBody
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          canModerate={canModerate}
          onClose={() => setOpen(false)}
          inSheet={false}
        />
      </aside>
    );
  }

  return (
    <Sheet open onOpenChange={setOpen}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <CommentPanelBody
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          canModerate={canModerate}
          onClose={() => setOpen(false)}
          inSheet
        />
      </SheetContent>
    </Sheet>
  );
}

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

function CommentPanelBody({
  currentUserId,
  currentUserName,
  canModerate,
  onClose,
  inSheet,
}: {
  currentUserId: string | null;
  currentUserName: string | null;
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
  const [replyTo, setReplyTo] = useState<string | null>(null);
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
    void load();
  }, [load, setHighlightId]);

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
          {inSheet ? (
            <>
              <SheetTitle className="truncate text-sm">{title}</SheetTitle>
              <SheetDescription className="text-[11px]">{description}</SheetDescription>
            </>
          ) : (
            <>
              <h2 className="truncate text-sm font-medium text-ink">{title}</h2>
              <p className="text-[11px] text-ink-3">{description}</p>
            </>
          )}
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
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="text-xs text-ink-3">
            No comments here — this page isn&rsquo;t something you can comment on.
            Open another page and its thread appears.
          </p>
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
                onApplyView={applyView}
                onReply={(rootId) => setReplyTo(rootId)}
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
              <div className="mb-2 flex items-center gap-2 text-[11px] text-ink-3">
                <span>Replying in this thread</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => setReplyTo(null)}
                  aria-label="Cancel reply"
                  className="h-5 px-1"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}
            <CommentComposer
              key={`${anchorKey}:${replyTo ?? "root"}`}
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
                    parentId: replyTo,
                    authorUserId: currentUserId,
                    authorName: currentUserName,
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
                  const res = await createComment({
                    anchorType: anchor.type,
                    anchorId: anchor.id,
                    parentId: replyTo,
                    body,
                    // Minus `?comment=`: a deep link's navigation is not part
                    // of what the reader was looking at (2026-10).
                    viewQuery:
                      typeof window === "undefined"
                        ? ""
                        : stripCommentParam(window.location.search),
                    mentionUserIds,
                  });
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
                  throw err; // the composer's safeAction turns it into a toast
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
