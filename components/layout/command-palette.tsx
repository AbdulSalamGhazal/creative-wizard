"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Search } from "lucide-react";
import type { CreativeOption } from "@/db/queries/creatives";
import type { PaletteCampaign } from "@/db/queries/campaign";
import type { SavedViewOption } from "@/db/queries/summary-views";

/** The palette's dialog module — the import is the preload. */
const loadDialog = () => import("@/components/layout/command-palette-dialog");

// cmdk and the lists arrive with the dialog (W2-8). Nothing renders while it
// loads — the idle / hover / ⌘ preloads make that a case you'd have to race.
const CommandPaletteDialog = dynamic(() => loadDialog().then((m) => m.CommandPaletteDialog), {
  ssr: false,
  loading: () => null,
});

/** Everything the palette lists besides pages, for one brand. */
export interface PaletteLists {
  creatives: CreativeOption[];
  /** R-027 (2026-11-07): campaigns have their own pages too. */
  campaigns: PaletteCampaign[];
  /** The viewer's own saved views, every page (views are private). */
  views: SavedViewOption[];
}

/**
 * THE ENTITY LISTS, per brand, for this tab (D13, 2026-10). They used to be
 * queried by the dashboard layout and shipped with every full render; they
 * are now fetched from `/api/palette` the first time they're wanted — on
 * idle, on intent (hover / focus / ⌘), or on open — and refreshed in the
 * background on every later open, so a creative made a minute ago is there.
 * Keyed by brand: a brand switch starts a new list.
 */
type ListState =
  | { status: "idle" }
  | { status: "loading"; lists: PaletteLists | null }
  | { status: "ready"; lists: PaletteLists }
  | { status: "failed"; lists: PaletteLists | null };

const cache = new Map<string, PaletteLists>();
const inFlight = new Map<string, Promise<PaletteLists | null>>();

function fetchLists(accountId: string): Promise<PaletteLists | null> {
  const running = inFlight.get(accountId);
  if (running) return running;
  const p = fetch("/api/palette", { cache: "no-store" })
    .then(async (res) => {
      if (!res.ok) return null;
      const data = (await res.json()) as Partial<PaletteLists>;
      const lists: PaletteLists = {
        creatives: data.creatives ?? [],
        campaigns: data.campaigns ?? [],
        views: data.views ?? [],
      };
      cache.set(accountId, lists);
      return lists;
    })
    .catch(() => null)
    .finally(() => inFlight.delete(accountId));
  inFlight.set(accountId, p);
  return p;
}

interface Props {
  /** The active brand — the lists are per brand. */
  accountId: string;
  /** The viewer's permission keys — the page list is filtered by them. */
  granted: string[];
  /** Visual trigger lives in the top-bar; pass true if you want the in-line trigger style. */
  showTrigger?: boolean;
}

/**
 * ⌘K — the triggers and the shortcut. The dialog itself (cmdk, the page list,
 * the entity lists) is a lazily loaded module (W2-8, 2026-10): it used to be
 * in every route's first download though it only draws when opened. It is
 * preloaded when the browser goes idle, when the pointer or focus reaches a
 * trigger, and the moment ⌘/Ctrl goes down — so the first open stays instant.
 *
 * TWO TRIGGERS, one dialog: the wide search field from `md` up, and below it
 * an icon button the size of the bell beside it (R-001, 2026-11-07) — a phone
 * has no ⌘K, and search had simply vanished there.
 */
/** A touch phone (below `md`): its trigger is the icon, tapped on purpose. */
const TOUCH_PHONE = "(max-width: 767px) and (pointer: coarse)";

export function CommandPalette({ accountId, granted, showTrigger = true }: Props) {
  const [open, setOpen] = useState(false);
  // Mounted on first open and kept: the Radix dialog's useId-based ids would
  // mismatch if rendered during SSR, and it's only ever opened client-side.
  const [everOpened, setEverOpened] = useState(false);
  const [list, setList] = useState<ListState>(() => {
    const cached = cache.get(accountId);
    return cached ? { status: "ready", lists: cached } : { status: "idle" };
  });

  /** Load (or refresh) this brand's lists; keeps what's shown meanwhile. */
  const loadList = useCallback(() => {
    const shown = cache.get(accountId) ?? null;
    setList((s) => (s.status === "ready" ? s : { status: "loading", lists: shown }));
    void fetchLists(accountId).then((fresh) => {
      if (fresh) setList({ status: "ready", lists: fresh });
      else setList({ status: "failed", lists: cache.get(accountId) ?? null });
    });
  }, [accountId]);

  // A brand switch: show that brand's lists if this tab has them, else none yet.
  useEffect(() => {
    const cached = cache.get(accountId);
    setList(cached ? { status: "ready", lists: cached } : { status: "idle" });
  }, [accountId]);

  /** Code AND data, ahead of the first open. */
  const preload = useCallback(() => {
    void loadDialog();
    if (!cache.has(accountId) && !inFlight.has(accountId)) loadList();
  }, [accountId, loadList]);

  useEffect(() => {
    if (open) {
      setEverOpened(true);
      // Every open refreshes in the background; what's cached shows at once.
      loadList();
    }
  }, [open, loadList]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Meta" || e.key === "Control") preload();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preload]);

  // IDLE PRELOAD (Safari has no requestIdleCallback — a timeout stands in).
  // Not on a touch phone: there the palette opens only from its icon, whose
  // tap preloads on the way in, so an idle fetch would usually be wasted.
  useEffect(() => {
    if (window.matchMedia?.(TOUCH_PHONE).matches) return;
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(preload, { timeout: 4000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(preload, 1500);
    return () => window.clearTimeout(t);
  }, [preload]);

  const lists = list.status === "idle" ? null : list.lists;

  return (
    <>
      {showTrigger && (
        <>
          <button
            type="button"
            onClick={() => setOpen(true)}
            onPointerEnter={preload}
            onFocus={preload}
            className="hidden md:flex items-center gap-2 text-xs text-ink-2 px-3 h-8 rounded-md border border-line bg-surface min-w-[260px] hover:bg-surface-2 transition-colors"
            aria-label="Open command palette"
          >
            <Search className="w-3.5 h-3.5 text-ink-3" />
            <span className="text-ink-3">Search creatives, pages…</span>
            <span className="ml-auto px-1.5 py-0.5 rounded-sm text-[10px] bg-surface-2 border border-line text-ink-2">
              ⌘K
            </span>
          </button>
          {/* Below md: the same dialog behind an icon (R-001). */}
          <button
            type="button"
            onClick={() => setOpen(true)}
            onPointerDown={preload}
            onFocus={preload}
            aria-label="Search"
            title="Search"
            className="md:hidden inline-flex h-8 w-8 items-center justify-center rounded-md border border-line text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <Search className="h-4 w-4" />
          </button>
        </>
      )}
      {(open || everOpened) && (
        <CommandPaletteDialog
          open={open}
          onOpenChange={setOpen}
          lists={lists}
          listsFailed={list.status === "failed" && !lists}
          onRetryLists={loadList}
          granted={granted}
        />
      )}
    </>
  );
}
