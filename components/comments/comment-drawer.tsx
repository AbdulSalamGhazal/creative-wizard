"use client";

import {
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  monthAnchorLabel,
  viewLabel,
  type CommentAnchor,
} from "@/lib/comments";
import { useCommentAnchor } from "@/components/comments/comment-anchor-context";
import { CommentThread } from "@/components/comments/comment-thread";
import { CommentComposer } from "@/components/comments/comment-composer";
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
    () => ({ open, setOpen, highlightId, setHighlightId, count, setCount }),
    [open, setOpen, highlightId, count],
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
 */
function DeepLinkOpener() {
  const searchParams = useSearchParams();
  const { setOpen, setHighlightId } = usePanel();
  const id = searchParams.get(COMMENT_PARAM);
  useEffect(() => {
    if (!id) return;
    setOpen(true);
    setHighlightId(id);
  }, [id, setOpen, setHighlightId]);
  return null;
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
  canModerate,
}: {
  currentUserId: string | null;
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
  canModerate,
  onClose,
  inSheet,
}: {
  currentUserId: string | null;
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
  const { highlightId, setHighlightId, setCount } = usePanel();
  const [rows, setRows] = useState<CommentRow[] | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const anchorKey = anchorKeyOf(anchor);

  const load = useCallback(async () => {
    if (!anchor) return;
    try {
      const res = await fetch(`/api/comments?${anchorParams(anchor)}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { comments: WireComment[] };
      const hydrated = hydrate(data.comments ?? []);
      setRows(hydrated);
      setCount(hydrated.filter((c) => c.deletedAt === null).length);
    } catch {
      setRows([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey, setCount]);

  // A new page is a new conversation; the panel itself stays open.
  useEffect(() => {
    setRows(null);
    setReplyTo(null);
    void load();
  }, [load]);

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
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {rows === null ? (
              <p className="py-8 text-center text-xs text-ink-3">Loading…</p>
            ) : (
              <CommentThread
                comments={rows}
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
              anchorType={anchor.type}
              anchorId={anchor.id}
              parentId={replyTo}
              placeholder={replyTo ? "Write a reply…" : "Write a comment… (@ to mention)"}
              onPosted={() => {
                setReplyTo(null);
                void load();
              }}
            />
          </div>
        </>
      )}
    </>
  );
}
