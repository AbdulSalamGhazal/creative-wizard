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
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { MessageSquare, X } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { COMMENT_PARAM, type CommentAnchor } from "@/lib/comments";

/**
 * The comment panel's EAGER half (W2-7 + W2-8, 2026-10): the shared state, the
 * top-bar toggle and the dock's frame. Everything that draws a thread — the
 * thread, the composer, reactions, the mention picker, markdown — is
 * `comment-drawer.tsx`, which loads lazily (`next/dynamic`) and is PRELOADED
 * when the browser goes idle, or the moment the pointer or focus reaches the
 * toggle, so the first open is as instant as it was when the whole panel
 * shipped in every page's first download (~2,300 lines on every route).
 *
 * The panel — ONE surface for the whole app, DOCKED beside the page. It is not
 * a modal. On a desktop the page SQUEEZES to make room and stays fully visible
 * and fully interactive: no backdrop, no focus trap, no scroll lock, and
 * clicking the page doesn't close it. That is what makes click-to-apply-view
 * work — you click a comment, the page behind it re-filters, and you can keep
 * reading both. It lives in the dashboard layout, so it PERSISTS across
 * navigation and simply shows the next page's thread.
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
  /**
   * Live comments on the current anchor — the toggle's badge. Set by the
   * bell's per-navigation call (the chrome's ONE background request, W2-7)
   * and by the thread whenever it loads.
   */
  count: number;
  setCount: (count: number) => void;
}

const PanelContext = createContext<PanelState | null>(null);

export function usePanel(): PanelState {
  const value = useContext(PanelContext);
  if (!value) throw new Error("usePanel must be used inside <CommentPanelProvider>");
  return value;
}

export const anchorKeyOf = (anchor: CommentAnchor | null) =>
  anchor ? `${anchor.type}:${anchor.id}` : null;

/** The lazily loaded panel body — the import is the preload. */
const loadPanelBody = () => import("@/components/comments/comment-drawer");

/** Fetch the panel's code now, so opening it doesn't wait for a download. */
export function preloadCommentPanel(): void {
  void loadPanelBody();
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

  // IDLE PRELOAD: once the page has settled, fetch the panel's code in the
  // background, so a first open is instant without it being in the first
  // download. (Safari has no requestIdleCallback — a short timeout stands in.)
  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(preloadCommentPanel, { timeout: 4000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(preloadCommentPanel, 1500);
    return () => window.clearTimeout(t);
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
 * The top-bar icon. It TOGGLES the panel (the panel's own X closes it too) and
 * stays visible everywhere — the panel persists across pages, so the control
 * for it can't disappear on a page that has no thread. Its badge is set by the
 * bell's per-navigation call (W2-7); pointing at it or focusing it preloads
 * the panel's code.
 */
export function CommentToggle() {
  const { open, setOpen, count } = usePanel();
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      onPointerEnter={preloadCommentPanel}
      onFocus={preloadCommentPanel}
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
 * The panel's shape while its code arrives (only if it was opened before the
 * preload finished): the same header bar, an empty thread saying it's loading,
 * and the composer's footprint — so nothing jumps when the body replaces it.
 * Its X already works.
 */
function PanelBodyLoading() {
  const { setOpen } = usePanel();
  return (
    <>
      <div className="flex items-start gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="h-5 w-40 max-w-full animate-pulse rounded bg-surface-2" />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => setOpen(false)}
          aria-label="Close comments"
          className="h-7 w-7 shrink-0 p-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 px-3 py-3">
        <p className="py-8 text-center text-xs text-ink-3">Loading…</p>
      </div>
      <div className="border-t border-line px-3 py-3">
        <div className="h-[84px] animate-pulse rounded-md border border-line bg-surface-2/60" />
      </div>
    </>
  );
}

const CommentPanelBody = dynamic(
  () => loadPanelBody().then((m) => m.CommentPanelBody),
  { ssr: false, loading: () => <PanelBodyLoading /> },
);

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
  currentUserAvatarUrl,
  canModerate,
}: {
  currentUserId: string | null;
  /** Your name and photo, for the row a post shows while it is on its way. */
  currentUserName: string | null;
  currentUserAvatarUrl: string | null;
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
          currentUserAvatarUrl={currentUserAvatarUrl}
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
          currentUserAvatarUrl={currentUserAvatarUrl}
          canModerate={canModerate}
          onClose={() => setOpen(false)}
          inSheet
        />
      </SheetContent>
    </Sheet>
  );
}
