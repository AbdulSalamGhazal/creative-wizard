"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useNavTransition } from "@/lib/nav-progress";
import { guardedDestination } from "@/lib/unsaved-guard";

/**
 * The house unsaved-changes guard for an editor with an explicit Save: while
 * `dirty`, leaving the page asks first. Two layers, because App Router has no
 * route-change event to veto:
 *
 * - **In-app links** (sidebar, pager, "Back to …", any `<Link>`): a
 *   capture-phase click listener on `document` runs BEFORE React's root
 *   listener, so the Link never sees the click; the guard opens the dialog
 *   and, on "Discard and leave", resets the draft (`onDiscard`) and pushes the
 *   destination itself. "Keep editing" (and Escape) just closes it. Which
 *   clicks count is `lib/unsaved-guard.ts` — a new-tab click, a download, a
 *   hash jump or a cross-origin link pass.
 * - **A real leave** (reload, closing the tab, typing a URL): `beforeunload`,
 *   which shows the browser's own prompt.
 *
 * NOT covered, by design (there is no hook to cancel them): the browser's
 * Back button, programmatic navigations (⌘K, the brand switcher) — a draft is
 * a few fields, and fighting `popstate` breaks the router.
 *
 * Mount it once inside the editor; it renders nothing until it has to.
 */
export function UnsavedChangesGuard({
  dirty,
  onDiscard,
  title = "Discard unsaved changes?",
  description,
}: {
  dirty: boolean;
  /** Reset the editor to its saved state — called before the guard navigates. */
  onDiscard: () => void;
  title?: string;
  description: string;
}) {
  const router = useRouter();
  // The navigation shows the progress bar (W3-6).
  const [, startNav] = useNavTransition();
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    const onClick = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target.closest("a[href]") : null;
      const anchor = el instanceof HTMLAnchorElement ? el : null;
      const destination = guardedDestination(
        {
          href: anchor?.href ?? null,
          target: anchor?.target ?? "",
          download: anchor?.hasAttribute("download") ?? false,
          button: e.button,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          defaultPrevented: e.defaultPrevented,
        },
        window.location.href,
      );
      if (!destination) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setPending(destination);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  const leave = () => {
    const destination = pending;
    if (!destination) return;
    setPending(null);
    onDiscard();
    startNav(() => router.push(destination));
  };

  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setPending(null)}>
            Keep editing
          </Button>
          <Button variant="destructive" onClick={leave}>
            Discard and leave
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
