"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { currentAppPathname, usePathname, useRouter } from "@/lib/brand-nav";
import { useNavTransition } from "@/lib/nav-progress";
import { onOpenShortcutSheet } from "@/lib/shortcut-sheet";
import { navItemHref } from "@/components/layout/nav-items";
import {
  formatKeys,
  ownsKeys,
  shortcutGroups,
  shortcutKey,
  type ShortcutEntry,
  type ShortcutGroup,
} from "@/components/layout/nav-shortcuts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";

/** How long a first key waits for its second before it lapses. */
const CHORD_TIMEOUT_MS = 4000;
const MODIFIER_KEYS = new Set(["Shift", "Meta", "Control", "Alt", "CapsLock", "Fn"]);

/**
 * Keyboard navigation (2026-11-22): two letters open a page — B then P is
 * Budget · Plan (`nav-shortcuts.ts` holds the map). The first key raises a
 * strip at the bottom listing that group's second keys; the second key goes;
 * Esc, a click, any other key or a pause lets it lapse. "?" opens the list of
 * every shortcut the viewer has (also reachable from the account menu).
 *
 * Silent while you type or while anything sits on top of the page (a dialog,
 * a menu, ⌘K) — those own their keys (`ownsKeys`).
 */
export function KeyboardShortcuts({ granted }: { granted: string[] }) {
  const groups = useMemo(() => shortcutGroups(granted), [granted]);
  const [pending, setPending] = useState<ShortcutGroup | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const pendingRef = useRef<ShortcutGroup | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const router = useRouter();
  const [, startNav] = useNavTransition();
  const pathname = usePathname();

  const arm = useCallback((group: ShortcutGroup | null) => {
    window.clearTimeout(timer.current);
    pendingRef.current = group;
    setPending(group);
    if (group) timer.current = window.setTimeout(() => arm(null), CHORD_TIMEOUT_MS);
  }, []);

  const go = useCallback(
    (entry: ShortcutEntry) => {
      // The same href a sidebar click resolves — Budget keeps its ?month=,
      // Pricing its ?v= (navItemHref, from the address bar at key time).
      const target = navItemHref(
        entry,
        currentAppPathname(),
        new URLSearchParams(window.location.search),
      );
      if (target === currentAppPathname() + window.location.search) return;
      startNav(() => router.push(target));
    },
    [router, startNav],
  );

  useEffect(() => onOpenShortcutSheet(() => setSheetOpen(true)), []);
  // Arriving anywhere (by any means) ends a half-typed shortcut.
  useEffect(() => arm(null), [pathname, arm]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || ownsKeys(e.target)) return;
      // A modifier on its own (Shift on the way to "?") is not a keypress yet.
      if (MODIFIER_KEYS.has(e.key)) return;
      const key = shortcutKey(e);
      const group = pendingRef.current;
      if (group) {
        arm(null);
        const entry = key ? group.entries.find((x) => x.key === key) : undefined;
        if (entry) {
          e.preventDefault();
          go(entry);
        } else if (key === "escape") {
          e.preventDefault();
        }
        return;
      }
      if (!key) return;
      if (key === "?") {
        e.preventDefault();
        setSheetOpen(true);
        return;
      }
      const next = groups.find((g) => g.leader === key);
      if (next) {
        e.preventDefault();
        arm(next);
      }
    };
    const onPointer = () => {
      if (pendingRef.current) arm(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [groups, arm, go]);

  return (
    <>
      {/* The hint strip. Announced politely, so a screen reader hears which
          group is waiting for its second key. */}
      <div role="status" aria-live="polite" className="sr-only">
        {pending ? `${pending.label} shortcuts: press a letter, or Escape to cancel.` : ""}
      </div>
      {pending && (
        <div
          aria-hidden
          data-screenshot-exclude
          className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-[var(--gutter)] pointer-events-none"
        >
          <div className="flex max-w-full flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-line bg-popover px-4 py-2.5 text-xs text-ink-2 shadow-md">
            <span className="flex items-center gap-1.5 font-medium text-ink">
              <Kbd>{pending.leader.toUpperCase()}</Kbd>
              {pending.label}
            </span>
            {pending.entries.map((e) => (
              <span key={e.key} className="flex items-center gap-1.5">
                <Kbd>{e.key.toUpperCase()}</Kbd>
                {e.label}
              </span>
            ))}
          </div>
        </div>
      )}
      <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto" data-screenshot-exclude>
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-1.5 text-xs text-ink-2">
              Two keys open a page — <Kbd>B</Kbd> then <Kbd>P</Kbd> is Budget · Plan.{" "}
              <Kbd>?</Kbd> shows this list.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
            {groups.map((g) => (
              <section key={g.leader} aria-label={g.label}>
                <h3 className="mb-1.5 flex items-center gap-2 text-label text-ink-2">
                  <Kbd>{g.leader.toUpperCase()}</Kbd>
                  {g.label}
                </h3>
                <ul className="space-y-1">
                  {g.entries.map((e) => (
                    <li key={e.key} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate text-ink">{e.label}</span>
                      <span
                        className="flex shrink-0 gap-1"
                        aria-label={`${g.leader.toUpperCase()} then ${e.key.toUpperCase()}`}
                      >
                        {formatKeys(g.leader + e.key)
                          .split(" ")
                          .map((k, i) => (
                            <Kbd key={i}>{k}</Kbd>
                          ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
