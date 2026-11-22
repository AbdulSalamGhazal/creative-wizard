import {
  NAV_SECTIONS,
  navSections,
  qualifiedNavLabel,
  type NavSectionKey,
} from "@/components/layout/nav-items";

/**
 * KEYBOARD NAVIGATION (user-approved key map, 2026-11-22). A page's shortcut is
 * two letters: its group's first key, then its own — B then P opens Budget ·
 * Plan. The letters live ON the nav data (`NAV_SECTIONS[].shortcut`,
 * `NavItem.keys`, a hub's `hubShortcut` + `NavChild.keys`), so a page's
 * shortcut is declared where the page is, and the groups below are DERIVED
 * from the visible nav: a page the viewer can't see has no shortcut — it is
 * missing from the "?" list and the hint strip, and its keys do nothing.
 *
 * Letters, not positions, on purpose: they mean the same page for everyone and
 * survive a reorder or a hidden page (the number scheme was considered and
 * declined for exactly that).
 */
export interface ShortcutEntry {
  /** The second key. */
  key: string;
  /** The page's own label ("Plan"). */
  label: string;
  /** Where it stands alone ("Budget · Plan") — the sidebar's tooltip. */
  qualified: string;
  href: string;
  /** The nav section it belongs to — decides which URL param it carries. */
  group: NavSectionKey;
}

export interface ShortcutGroup {
  /** The first key. */
  leader: string;
  label: string;
  entries: ShortcutEntry[];
}

/** The shortcut groups the viewer can use, in nav order (a hub follows its section). */
export function shortcutGroups(granted: Iterable<string>): ShortcutGroup[] {
  const groups: ShortcutGroup[] = [];
  for (const section of navSections(granted)) {
    const leader = NAV_SECTIONS.find((s) => s.key === section.key)!.shortcut;
    const own: ShortcutEntry[] = [];
    const hubs: ShortcutGroup[] = [];
    for (const item of section.items) {
      if (item.children && item.hubShortcut) {
        hubs.push({
          leader: item.hubShortcut,
          label: item.label,
          entries: item.children.map((c) => ({
            key: c.keys[1]!,
            label: c.label,
            qualified: `${item.label} · ${c.label}`,
            href: c.href,
            group: section.key,
          })),
        });
      } else if (item.keys) {
        own.push({
          key: item.keys[1]!,
          label: item.label,
          qualified: qualifiedNavLabel(section, item.label),
          href: item.href,
          group: section.key,
        });
      }
    }
    if (own.length > 0) groups.push({ leader, label: section.label, entries: own });
    groups.push(...hubs);
  }
  return groups;
}

/** "bp" → "B P" — how a shortcut is printed (tooltips, the list). */
export function formatKeys(keys: string): string {
  return keys.toUpperCase().split("").join(" ");
}

/** The shape of a key event the resolver reads (a DOM KeyboardEvent fits). */
export interface ShortcutKeyEvent {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  repeat: boolean;
  isComposing?: boolean;
}

/**
 * The shortcut key an event means: a lowercase a–z, "?", "escape", or null.
 * Letters are read from the PHYSICAL key (`code`), so B is B on an Arabic
 * layout too (where `key` would be "لا"). Anything held with ⌘/Ctrl/Alt is
 * someone else's shortcut (⌘K, the browser's own) and is ignored.
 */
export function shortcutKey(e: ShortcutKeyEvent): string | null {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.isComposing) return null;
  if (e.key === "Escape") return "escape";
  if (e.key === "?" || (e.code === "Slash" && e.key !== "/")) return "?";
  const m = /^Key([A-Z])$/.exec(e.code);
  return m ? m[1]!.toLowerCase() : null;
}

/**
 * Whether a keypress belongs to what has focus rather than to navigation:
 * anything you type into, and anything open on top of the page (a dialog, a
 * menu, a listbox — ⌘K's included), where letters are its own.
 */
export function ownsKeys(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return (
    target.closest(
      'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
    ) !== null
  );
}
