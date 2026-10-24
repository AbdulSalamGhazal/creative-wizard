"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Search } from "lucide-react";
import type { CreativeOption } from "@/db/queries/creatives";

/** The palette's dialog module — the import is the preload. */
const loadDialog = () => import("@/components/layout/command-palette-dialog");

// cmdk and the lists arrive with the dialog (W2-8). Nothing renders while it
// loads — the idle / hover / ⌘ preloads make that a case you'd have to race.
const CommandPaletteDialog = dynamic(() => loadDialog().then((m) => m.CommandPaletteDialog), {
  ssr: false,
  loading: () => null,
});

/**
 * THE CREATIVE LIST, per brand, for this tab (D13, 2026-10). It used to be
 * queried by the dashboard layout and shipped with every full render; it is
 * now fetched from `/api/palette` the first time it's wanted — on idle, on
 * intent (hover / focus / ⌘), or on open — and refreshed in the background on
 * every later open, so a creative made a minute ago is there. Keyed by brand:
 * a brand switch starts a new list.
 */
type ListState =
  | { status: "idle" }
  | { status: "loading"; creatives: CreativeOption[] | null }
  | { status: "ready"; creatives: CreativeOption[] }
  | { status: "failed"; creatives: CreativeOption[] | null };

const cache = new Map<string, CreativeOption[]>();
const inFlight = new Map<string, Promise<CreativeOption[] | null>>();

function fetchCreatives(accountId: string): Promise<CreativeOption[] | null> {
  const running = inFlight.get(accountId);
  if (running) return running;
  const p = fetch("/api/palette", { cache: "no-store" })
    .then(async (res) => {
      if (!res.ok) return null;
      const data = (await res.json()) as { creatives?: CreativeOption[] };
      const list = data.creatives ?? [];
      cache.set(accountId, list);
      return list;
    })
    .catch(() => null)
    .finally(() => inFlight.delete(accountId));
  inFlight.set(accountId, p);
  return p;
}

interface Props {
  /** The active brand — the creative list is per brand. */
  accountId: string;
  /** The viewer's permission keys — the page list is filtered by them. */
  granted: string[];
  /** Visual trigger lives in the top-bar; pass true if you want the in-line trigger style. */
  showTrigger?: boolean;
}

/**
 * ⌘K — the trigger and the shortcut. The dialog itself (cmdk, the page list,
 * the creative list) is a lazily loaded module (W2-8, 2026-10): it used to be
 * in every route's first download though it only draws when opened. It is
 * preloaded when the browser goes idle, when the pointer or focus reaches the
 * trigger, and the moment ⌘/Ctrl goes down — so the first open stays instant.
 */
/** A touch screen narrower than `md` — the trigger is `hidden md:flex`. */
const NO_TRIGGER_TOUCH = "(max-width: 767px) and (pointer: coarse)";

export function CommandPalette({ accountId, granted, showTrigger = true }: Props) {
  const [open, setOpen] = useState(false);
  // Mounted on first open and kept: the Radix dialog's useId-based ids would
  // mismatch if rendered during SSR, and it's only ever opened client-side.
  const [everOpened, setEverOpened] = useState(false);
  const [list, setList] = useState<ListState>(() => {
    const cached = cache.get(accountId);
    return cached ? { status: "ready", creatives: cached } : { status: "idle" };
  });

  /** Load (or refresh) this brand's list; keeps what's shown meanwhile. */
  const loadList = useCallback(() => {
    const shown = cache.get(accountId) ?? null;
    setList((s) =>
      s.status === "ready" ? s : { status: "loading", creatives: shown },
    );
    void fetchCreatives(accountId).then((fresh) => {
      if (fresh) setList({ status: "ready", creatives: fresh });
      else setList({ status: "failed", creatives: cache.get(accountId) ?? null });
    });
  }, [accountId]);

  // A brand switch: show that brand's list if this tab has it, else none yet.
  useEffect(() => {
    const cached = cache.get(accountId);
    setList(cached ? { status: "ready", creatives: cached } : { status: "idle" });
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
  // Not on a touch phone: below `md` there is no trigger and no ⌘ key, so the
  // palette can't be opened there and the preload is ~2 requests for nothing.
  useEffect(() => {
    if (window.matchMedia?.(NO_TRIGGER_TOUCH).matches) return;
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

  const creatives =
    list.status === "ready" ? list.creatives : list.status === "idle" ? null : list.creatives;

  return (
    <>
      {showTrigger && (
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
          <span className="ml-auto px-1.5 py-0.5 rounded text-[10px] bg-surface-2 border border-line text-ink-3">
            ⌘K
          </span>
        </button>
      )}
      {(open || everOpened) && (
        <CommandPaletteDialog
          open={open}
          onOpenChange={setOpen}
          creatives={creatives}
          creativesFailed={list.status === "failed" && !creatives}
          onRetryCreatives={loadList}
          granted={granted}
        />
      )}
    </>
  );
}
