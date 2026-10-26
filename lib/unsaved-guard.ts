/**
 * The pure half of the unsaved-changes guard (components/ui/unsaved-changes-
 * guard.tsx): given a click and the page it happened on, the in-app
 * destination that click would LEAVE for — or null when the click should
 * pass untouched. App Router has no route-change event to veto, so the guard
 * intercepts anchor clicks itself; this decides which ones count.
 *
 * Passes (null): no anchor; a click the browser would not navigate on (not
 * the main button, a modifier key — those open a new tab and keep the page);
 * an anchor that opens elsewhere (`target`, `download`); a cross-origin href
 * (`beforeunload` covers a real leave); the same page (hash-only, or a link
 * back to where we are). Everything else returns `pathname + search + hash`,
 * ready for `router.push` once the person confirms.
 */
export interface GuardedClick {
  /** The anchor's RESOLVED href (`anchor.href`), or null when no anchor was clicked. */
  href: string | null;
  /** `anchor.target` ("" when unset). */
  target: string;
  /** Whether the anchor carries a `download` attribute. */
  download: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** A handler before us already cancelled the click. */
  defaultPrevented: boolean;
}

export function guardedDestination(click: GuardedClick, currentHref: string): string | null {
  if (!click.href || click.defaultPrevented) return null;
  if (click.button !== 0) return null;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null;
  if (click.target && click.target !== "_self") return null;
  if (click.download) return null;

  let next: URL;
  let current: URL;
  try {
    current = new URL(currentHref);
    next = new URL(click.href, current);
  } catch {
    return null;
  }
  if (next.origin !== current.origin) return null;
  if (next.pathname === current.pathname && next.search === current.search) return null;
  return `${next.pathname}${next.search}${next.hash}`;
}
