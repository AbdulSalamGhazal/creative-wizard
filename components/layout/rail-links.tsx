"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { GitCompare, Link2, Workflow } from "lucide-react";
import { toast } from "sonner";
import Link from "@/components/nav/link";
import { useCommentAnchor } from "@/components/comments/comment-anchor-context";
import { brandHref, usePathname } from "@/lib/brand-nav";
import { entityShareHref } from "@/lib/comments";
import { cn } from "@/lib/utils";

/**
 * The rail's "open this elsewhere" links (2026-11-21, user-approved): an
 * entity page hands the rail its Compare and Canvas destinations, already
 * built server-side over the page's range, by rendering `<RailLinks>`. The
 * rail lives in the dashboard layout and knows nothing about the page, so
 * this is the same registration shape as `<CommentAnchor>`: the entry carries
 * the path it was made on, and a stale one from the page just left never
 * shows on the next.
 *
 * Below `lg` there is no rail, so the page keeps its in-page buttons there.
 */
export interface RailLinkHrefs {
  /** Into Compare with this entity as side A (`compareHref`). */
  compare?: string;
  /** Into the Canvas focused on this entity (`canvasFocusHref`). */
  canvas?: string;
}

interface Registration {
  path: string;
  links: RailLinkHrefs;
}

interface RailLinksContextValue {
  links: RailLinkHrefs | null;
  register: (registration: Registration | null, path: string) => void;
}

const RailLinksContext = createContext<RailLinksContextValue>({
  links: null,
  register: () => {},
});

export function RailLinksProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [entry, setEntry] = useState<Registration | null>(null);
  // Stable, so a page's registering effect runs once per page, not per render.
  // Clearing passes null with the path it registered on, so an unmount
  // landing after the next page registered leaves that page's links.
  const register = useCallback((registration: Registration | null, path: string) => {
    setEntry((current) => (registration ? registration : current?.path === path ? null : current));
  }, []);
  const value = useMemo<RailLinksContextValue>(
    () => ({ links: entry && entry.path === pathname ? entry.links : null, register }),
    [entry, pathname, register],
  );
  return <RailLinksContext.Provider value={value}>{children}</RailLinksContext.Provider>;
}

/** What the rail shows below its divider on this page. */
export function useRailLinks(): RailLinkHrefs | null {
  return useContext(RailLinksContext).links;
}

/** One rail button's frame — the panel toggles and the links share it. */
export const railItemClass =
  "group relative inline-flex h-8 w-8 items-center justify-center rounded-md border text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink";

/**
 * A rail button's NAME, shown to its left on hover and on keyboard focus
 * (user ask 2026-11-21: "when hover, the name shows"). Visual only — the
 * button's `aria-label` is what a screen reader hears, so this is
 * `aria-hidden`, and the button drops its `title` (no double tooltip).
 */
export function RailLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute right-full top-1/2 mr-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-line bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      {children}
    </span>
  );
}

/**
 * Below the rail's divider: the page's Compare and Canvas links (when it
 * registered them) and Copy link, which every entity page has — the entity's
 * own address (`entityShareHref`), never the reader's filters or range.
 */
export function RailLinkGroup() {
  const pathname = usePathname();
  const anchor = useCommentAnchor();
  const links = useRailLinks();
  const share = entityShareHref(pathname, anchor);
  if (share === null) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin + brandHref(share));
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy the link. Copy it from the address bar.");
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div aria-hidden className="my-1 w-5 border-t border-line" />
      {links?.compare && (
        <Link href={links.compare} aria-label="Compare" className={cn(railItemClass, "border-transparent")}>
          <GitCompare className="h-4 w-4" />
          <RailLabel>Compare</RailLabel>
        </Link>
      )}
      {links?.canvas && (
        <Link
          href={links.canvas}
          aria-label="Open in Canvas"
          className={cn(railItemClass, "border-transparent")}
        >
          <Workflow className="h-4 w-4" />
          <RailLabel>Open in Canvas</RailLabel>
        </Link>
      )}
      <button
        type="button"
        onClick={copy}
        aria-label="Copy link"
        className={cn(railItemClass, "border-transparent")}
      >
        <Link2 className="h-4 w-4" />
        <RailLabel>Copy link</RailLabel>
      </button>
    </div>
  );
}

/** Rendered by an entity page: registers its rail links. Renders nothing. */
export function RailLinks({ compare, canvas }: RailLinkHrefs) {
  const { register } = useContext(RailLinksContext);
  const path = usePathname();
  useEffect(() => {
    register({ path, links: { compare, canvas } }, path);
    return () => register(null, path);
  }, [register, path, compare, canvas]);
  return null;
}
