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
import { usePathname, useSearchParams } from "next/navigation";
import { Activity, MessageSquare, X } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { COMMENT_PARAM, isEntityRoute, type CommentAnchor } from "@/lib/comments";

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
const MODE_KEY = "cw-panel-mode";

/**
 * Tailwind's `xl` (2026-11-07, user decision). At `lg` (1024) the sidebar, a
 * 380px panel and the rail left the page 357px and crushed two-column pages
 * (Price Structure's Products); below `xl` the panel opens as an overlay.
 */
const DOCK_QUERY = "(min-width: 1280px)";

/**
 * What the panel shows (2026-11-07): the entity's comments, or its Activity —
 * its history of actions. One panel, two faces, chosen by the rail's buttons.
 */
export type PanelMode = "comments" | "activity";

interface PanelState {
  open: boolean;
  setOpen: (open: boolean) => void;
  mode: PanelMode;
  /**
   * A rail button: opens the panel on `mode`, or closes it when it is already
   * open on `mode` (the button toggles its own face).
   */
  toggleMode: (mode: PanelMode) => void;
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
  void import("@/components/comments/entity-activity");
}

export function CommentPanelProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpenState] = useState(false);
  const [mode, setModeState] = useState<PanelMode>("comments");
  const pathname = usePathname();
  const onEntityPage = isEntityRoute(pathname);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [deepLinkId, setDeepLinkId] = useState<string | null>(null);

  // Open/closed is a per-browser convenience that survives reloads; the server
  // never needs to know. Read after mount so there's no hydration mismatch.
  useEffect(() => {
    try {
      if (localStorage.getItem(OPEN_KEY) === "1") setOpenState(true);
      if (localStorage.getItem(MODE_KEY) === "activity") setModeState("activity");
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

  const toggleMode = useCallback(
    (next: PanelMode) => {
      if (open && mode === next) {
        setOpen(false);
        return;
      }
      setModeState(next);
      try {
        localStorage.setItem(MODE_KEY, next);
      } catch {
        /* ignore */
      }
      setOpen(true);
    },
    [open, mode, setOpen],
  );

  // The panel exists only on an ENTITY's page (2026-11-07): leaving for any
  // other page closes it — there is no rail there to reopen it from. Moving
  // between two entity pages keeps it open (the path decides, not the
  // registration, which arrives only once the next page has rendered).
  useEffect(() => {
    if (!onEntityPage && open) setOpen(false);
  }, [onEntityPage, open, setOpen]);

  const value = useMemo<PanelState>(
    () => ({
      open: open && onEntityPage,
      setOpen,
      mode,
      toggleMode,
      highlightId,
      setHighlightId,
      deepLinkId,
      setDeepLinkId,
    }),
    [open, onEntityPage, setOpen, mode, toggleMode, highlightId, deepLinkId],
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
  const pathname = usePathname();
  const { setOpen, setDeepLinkId, mode, toggleMode } = usePanel();
  const id = searchParams.get(COMMENT_PARAM);
  // Only an entity page has the panel; `/activity?comment=` is the feed's own
  // one-comment view and never opens it.
  const here = isEntityRoute(pathname);
  useEffect(() => {
    if (!id || !here) return;
    if (mode !== "comments") toggleMode("comments");
    else setOpen(true);
    setDeepLinkId(id);
    // `mode`/`toggleMode` are read once per arrival, not tracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, here, setOpen, setDeepLinkId]);
  return null;
}

/**
 * The panel's two buttons — Comments and Activity (no count badge: user
 * decision 2026-11-07, "we don't need an indicator of how many")
 * (2026-11-07). They live in the RAIL beside the page on a desktop and in the
 * top bar below `lg`, and only on an entity's own page: anywhere else there is
 * nothing to comment on and no history to show. Each toggles its own face of
 * the one panel; pointing at either preloads the panel's code.
 */
export function PanelToggles({
  orientation,
  className,
}: {
  orientation: "vertical" | "horizontal";
  className?: string;
}) {
  const { open, mode, toggleMode } = usePanel();
  const pathname = usePathname();
  if (!isEntityRoute(pathname)) return null;
  const button = (face: PanelMode) =>
    cn(
      "relative inline-flex h-8 w-8 items-center justify-center rounded-md border text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink",
      open && mode === face ? "border-line bg-surface-2 text-ink" : "border-transparent",
      orientation === "horizontal" && !(open && mode === face) && "border-line",
    );
  return (
    <div
      className={cn(
        "flex items-center gap-2",
        orientation === "vertical" && "flex-col",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => toggleMode("comments")}
        onPointerEnter={preloadCommentPanel}
        onFocus={preloadCommentPanel}
        aria-pressed={open && mode === "comments"}
        aria-label="Comments"
        title="Comments"
        className={button("comments")}
      >
        <MessageSquare className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => toggleMode("activity")}
        onPointerEnter={preloadCommentPanel}
        onFocus={preloadCommentPanel}
        aria-pressed={open && mode === "activity"}
        aria-label="Activity"
        title="Activity"
        className={button("activity")}
      >
        <Activity className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * The RAIL (2026-11-07): a thin column at the page's right edge holding the
 * panel's two buttons, on a desktop, on an entity's page only. It sits OUTSIDE
 * the panel, so the buttons never move when the panel opens or closes.
 */
export function EntityRail() {
  const pathname = usePathname();
  if (!isEntityRoute(pathname)) return null;
  return (
    <aside
      aria-label="Comments and activity"
      className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-12 shrink-0 self-start border-l border-line bg-surface lg:block"
    >
      <PanelToggles orientation="vertical" className="pt-3" />
    </aside>
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
/** Whether the panel renders inside the phone Sheet (a dialog) — see below. */
const InSheetContext = createContext(false);

function PanelBodyLoading() {
  const { setOpen, mode } = usePanel();
  // In the phone Sheet the panel is a DIALOG, and it mounts before the body
  // (which carries the real SheetTitle) has loaded — an unnamed dialog. The
  // placeholder names it with the panel's own anchor-less title until then.
  const inSheet = useContext(InSheetContext);
  return (
    <>
      <div className="flex items-start gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          {inSheet && (
            <SheetTitle className="sr-only">
              {mode === "activity" ? "Activity" : "Comments"}
            </SheetTitle>
          )}
          <div className="h-5 w-40 max-w-full animate-pulse rounded bg-surface-2" />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => setOpen(false)}
          aria-label={mode === "activity" ? "Close activity" : "Close comments"}
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

/** The Activity face — lazy too, preloaded with the comments body. */
const loadActivityBody = () => import("@/components/comments/entity-activity");
const EntityActivityBody = dynamic(
  () => loadActivityBody().then((m) => m.EntityActivityBody),
  { ssr: false, loading: () => <PanelBodyLoading /> },
);

/**
 * Where the panel renders. Placed in the layout's content ROW, after the page
 * column (which is `flex-1 min-w-0`), so opening it squeezes the page rather
 * than covering it.
 *
 * BELOW `xl` (1280px) it falls back to the overlay Sheet: a phone has no room
 * to squeeze, and between `lg` and `xl` the sidebar + panel + rail would leave
 * the page ~357px. On those widths the modal trade-off is the right one.
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
  const { open, setOpen, mode } = usePanel();
  const canDock = useCanDock();

  if (!open || canDock === null) return null;

  const body = (inSheet: boolean) =>
    mode === "activity" ? (
      <EntityActivityBody onClose={() => setOpen(false)} inSheet={inSheet} />
    ) : (
      <CommentPanelBody
        currentUserId={currentUserId}
        currentUserName={currentUserName}
        currentUserAvatarUrl={currentUserAvatarUrl}
        canModerate={canModerate}
        onClose={() => setOpen(false)}
        inSheet={inSheet}
      />
    );

  if (canDock) {
    return (
      <aside
        aria-label={mode === "activity" ? "Activity" : "Comments"}
        // Sticky under the 3.5rem top bar with its OWN scroll, so the panel
        // stays put while the page scrolls beside it.
        className="sticky top-14 flex h-[calc(100vh-3.5rem)] w-[380px] shrink-0 flex-col self-start border-l border-line bg-surface"
      >
        {body(false)}
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
        <InSheetContext.Provider value>{body(true)}</InSheetContext.Provider>
      </SheetContent>
    </Sheet>
  );
}
