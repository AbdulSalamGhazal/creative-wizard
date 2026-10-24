"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Search } from "lucide-react";
import type { CreativeOption } from "@/components/layout/command-palette-dialog";

/** The palette's dialog module — the import is the preload. */
const loadDialog = () => import("@/components/layout/command-palette-dialog");

/** Fetch the palette's code now, so ⌘K doesn't wait for a download. */
function preloadPalette(): void {
  void loadDialog();
}

// cmdk and the lists arrive with the dialog (W2-8). Nothing renders while it
// loads — the idle / hover / ⌘ preloads make that a case you'd have to race.
const CommandPaletteDialog = dynamic(() => loadDialog().then((m) => m.CommandPaletteDialog), {
  ssr: false,
  loading: () => null,
});

interface Props {
  creatives: CreativeOption[];
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
export function CommandPalette({ creatives, granted, showTrigger = true }: Props) {
  const [open, setOpen] = useState(false);
  // Mounted on first open and kept: the Radix dialog's useId-based ids would
  // mismatch if rendered during SSR, and it's only ever opened client-side.
  const [everOpened, setEverOpened] = useState(false);
  useEffect(() => {
    if (open) setEverOpened(true);
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Meta" || e.key === "Control") preloadPalette();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // IDLE PRELOAD (Safari has no requestIdleCallback — a timeout stands in).
  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(preloadPalette, { timeout: 4000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(preloadPalette, 1500);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <>
      {showTrigger && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          onPointerEnter={preloadPalette}
          onFocus={preloadPalette}
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
          granted={granted}
        />
      )}
    </>
  );
}
