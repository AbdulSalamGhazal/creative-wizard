"use client";

import { useCallback, useState } from "react";
import {
  sectionForPath,
  type NavItem,
  type NavSectionKey,
} from "@/components/layout/nav-items";

/**
 * The nav's accordion (2026-11-08): AT MOST one section is open. Both navs —
 * the desktop Sidebar and the mobile Sheet — read it, so the rule lives once.
 *
 * - On load the current page's section is open (`sectionForPath`); a page
 *   outside the nav opens the first section.
 * - Opening a section closes the one that was open; clicking the open
 *   section's header closes it.
 * - Every navigation re-opens the section of the page arrived at, so a link
 *   followed from inside a page never leaves "you are here" folded away. A
 *   section opened by hand stays open until then.
 */
export function useOpenSection(
  sections: ReadonlyArray<{ key: NavSectionKey; items: NavItem[] }>,
  pathname: string,
): [NavSectionKey | null, (key: NavSectionKey) => void] {
  const current = sectionForPath(sections, pathname) ?? sections[0]?.key ?? null;
  const [open, setOpen] = useState<NavSectionKey | null>(current);

  // Follow navigation — adjusted during render (React's "storing information
  // from previous renders"), so the new section is open in the same paint as
  // the new page instead of one effect later.
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setOpen(current);
  }

  const toggle = useCallback(
    (key: NavSectionKey) => setOpen((o) => (o === key ? null : key)),
    [],
  );
  return [open, toggle];
}
