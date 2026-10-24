/**
 * SHALLOW URL writes (D12, 2026-10): change the address bar WITHOUT a server
 * render. Next 15 syncs the native `history.pushState` / `replaceState` into
 * the router, so `useSearchParams()` sees the new value and the component
 * re-renders from rows it already holds. For PRESENTATION-ONLY params —
 * a sort, which columns show — that used to cost a full server render each
 * (the Ads table: its 15 queries and ~2 KB per creative, per click). A fresh
 * load still honours the URL: the server reads the same params and sorts with
 * the same pure helper.
 *
 * `null` state, as Next documents: its patched history methods carry the
 * router's own state over and apply the new URL. `push` makes a history entry
 * (Back undoes it); `replace` doesn't.
 */
export function shallowHref(href: string, mode: "push" | "replace"): void {
  const url = new URL(href, window.location.href);
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (mode === "push") window.history.pushState(null, "", next);
  else window.history.replaceState(null, "", next);
}

/** Shallow-write the CURRENT URL's params after `mutate` changes them. */
export function shallowParams(
  mutate: (params: URLSearchParams) => void,
  mode: "push" | "replace",
): void {
  const url = new URL(window.location.href);
  mutate(url.searchParams);
  shallowHref(url.toString(), mode);
}

/**
 * For an `<a href>` that should navigate shallowly: a plain left click is
 * taken over; a modified click (new tab, new window) keeps the browser's own
 * behaviour, which the real `href` makes correct.
 */
export function isPlainClick(e: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}): boolean {
  return !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}
