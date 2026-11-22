/**
 * Opens the "?" keyboard-shortcut list from anywhere (the account menu's
 * "Keyboard shortcuts" item) without the two components sharing state: the
 * list lives with the shortcut listener (`components/layout/keyboard-shortcuts`),
 * which subscribes here.
 */
const OPEN_EVENT = "ccms:open-shortcuts";

export function openShortcutSheet(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function onOpenShortcutSheet(fn: () => void): () => void {
  window.addEventListener(OPEN_EVENT, fn);
  return () => window.removeEventListener(OPEN_EVENT, fn);
}
