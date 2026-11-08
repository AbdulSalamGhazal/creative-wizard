"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  Bookmark,
  Hash,
  History,
  Link2,
  Images,
  MessagesSquare,
  Package,
  Plug,
  Plus,
  Settings,
  Star,
  Upload,
} from "lucide-react";
import { ALL_COMMENTS_TITLE } from "@/lib/activity";
import { PLATFORM_LABEL } from "@/lib/palette";
import { PlatformDot } from "@/components/ui/platform-dot";
import { SAVED_VIEW_PAGE_LABEL, SAVED_VIEW_PATH, savedViewHref } from "@/lib/saved-view-href";
import type { PaletteLists } from "@/components/layout/command-palette";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { navSections, qualifiedNavLabel } from "@/components/layout/nav-items";
import { useNavTransition } from "@/lib/nav-progress";
import type { Permission } from "@/lib/permissions";
import {
  CONFIGURATION_TABS,
  LIBRARY_TABS,
  PRICE_STRUCTURE_GATE,
  UPLOAD_ADS_TABS,
  UPLOAD_ORDERS_TABS,
  type Gate,
  type GatedTab,
} from "@/lib/page-gates";

/** Palette entries for a page's GATED tabs (an open tab is the page itself,
 *  which the nav already lists); only tabs given an icon are offered. */
function tabEntries(
  base: string,
  pageLabel: string,
  tabs: readonly GatedTab[],
  icons: Record<string, React.ComponentType<{ className?: string }>>,
) {
  return tabs
    .filter((t): t is GatedTab & { perm: NonNullable<Gate> } => t.perm !== null && t.key in icons)
    .map((t) => ({
      href: `${base}?tab=${t.key}`,
      label: `${pageLabel} · ${t.label}`,
      icon: icons[t.key]!,
      perm: t.perm,
    }));
}

/**
 * Extra destinations the palette offers that the SIDEBAR doesn't: the "new"
 * flows and the in-page tabs, which are real places you'd want to jump to but
 * aren't nav items. Everything else is derived from NAV_ITEMS below, so a new
 * page appears here the moment it's added to the nav — the old hand-kept list
 * had already drifted (no Budget, no Store).
 */
const EXTRA_PAGES: Array<{
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Shown only if the user holds this permission — or, for a list, ANY of
   *  them (nav items self-gate). */
  perm?: Permission | readonly Permission[];
}> = [
  { href: "/library/new", label: "New creative", icon: Plus, perm: "creative.create" },
  // The in-page tabs read their gates from lib/page-gates — the same table
  // the page filters its tab row with (D18), so a tab and its palette entry
  // can't disagree. (Uploaders see Landing pages read-only; E023 sends them.)
  ...tabEntries("/library", "Library", LIBRARY_TABS, { products: Package, "landing-pages": Link2, angles: Hash }),
  { href: "/uploads/new", label: "New ad upload", icon: Upload, perm: "upload.import" },
  ...tabEntries("/uploads", "Upload ads", UPLOAD_ADS_TABS, { mapping: Settings }),
  { href: "/store/uploads/new", label: "New order upload", icon: Upload, perm: "store.upload" },
  ...tabEntries("/store/uploads", "Upload orders", UPLOAD_ORDERS_TABS, { fields: Settings }),
  ...tabEntries("/admin/catalog", "Configuration", CONFIGURATION_TABS, { rating: Star }),
  // Versions has no sidebar entry (the page header's picker leads there).
  { href: "/price-structure/versions", label: "Price structure · Versions", icon: History, perm: PRICE_STRUCTURE_GATE },
  // The user-level pages the bell footer and the avatar menu lead to — open to
  // every member and otherwise unreachable by search (R-001 / A3-20).
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/activity", label: ALL_COMMENTS_TITLE, icon: MessagesSquare },
  { href: "/account/api", label: "API access", icon: Plug },
];

/**
 * Every nav destination the user can actually reach, section-labelled, plus the
 * extras above. Derived from `navSections()` so permission filtering, ordering
 * and labels all come from the one nav source.
 */
function usePages(granted: string[]) {
  return useMemo(() => {
    const held = new Set(granted);
    const out: Array<{
      href: string;
      label: string;
      icon: React.ComponentType<{ className?: string }>;
    }> = [];
    for (const section of navSections(granted)) {
      for (const item of section.items) {
        // A hub item (Analyzers) is not itself a page — offer its children.
        if (item.children) {
          for (const c of item.children) {
            out.push({ href: c.href, label: `${item.label} · ${c.label}`, icon: item.icon });
          }
          continue;
        }
        out.push({
          href: item.href,
          // Section-qualify where the bare label would be ambiguous on its own
          // — the same rule as the collapsed rail's tooltips.
          label: qualifiedNavLabel(section, item.label),
          icon: item.icon,
        });
      }
    }
    for (const e of EXTRA_PAGES) {
      const perms: readonly Permission[] =
        e.perm === undefined ? [] : typeof e.perm === "string" ? [e.perm] : e.perm;
      if (perms.length === 0 || perms.some((p) => held.has(p))) {
        out.push({ href: e.href, label: e.label, icon: e.icon });
      }
    }
    return out;
  }, [granted]);
}

/**
 * The ⌘K palette's dialog — cmdk and the two lists. Loaded lazily (W2-8,
 * 2026-10) by `CommandPalette`, which keeps the trigger and the shortcut in
 * every page's first download and preloads this module when the browser is
 * idle (and on the trigger's hover/focus, and on ⌘/Ctrl going down).
 */
export function CommandPaletteDialog({
  open,
  onOpenChange,
  lists,
  listsFailed,
  onRetryLists,
  granted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** This brand's creatives, campaigns and the viewer's saved views, or null
   *  while the first load is on its way (D13). */
  lists: PaletteLists | null;
  /** The first load failed and there is nothing cached to show. */
  listsFailed: boolean;
  onRetryLists: () => void;
  /** The viewer's permission keys — the page list is filtered by them. */
  granted: string[];
}) {
  const creatives = lists?.creatives ?? null;
  const campaigns = lists?.campaigns ?? [];
  // A view whose page this build doesn't know is skipped, never mis-linked.
  const views = (lists?.views ?? []).filter((v) => v.page in SAVED_VIEW_PATH);
  const router = useRouter();
  const [, startNav] = useNavTransition();
  const PAGES = usePages(granted);

  const go = (href: string) => {
    onOpenChange(false);
    // Through the nav transition so the global progress bar shows — jumping
    // from the palette is exactly when you can't tell whether it registered.
    startNav(() => router.push(href));
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Jump to a page, creative or campaign…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        <CommandGroup heading="Pages">
          {PAGES.map((p) => {
            const Icon = p.icon;
            return (
              <CommandItem key={p.href} value={p.label} onSelect={() => go(p.href)}>
                <Icon className="w-3.5 h-3.5" />
                {p.label}
              </CommandItem>
            );
          })}
        </CommandGroup>
        {/* The creative list arrives on first open (D13): the pages are
            usable at once, and the list says where it is — the comment
            panel's wording for the same two states. */}
        {creatives === null && (
          <div className="px-3 py-2 text-xs text-ink-3" aria-live="polite">
            {listsFailed ? (
              <>
                Couldn&rsquo;t load creatives{" "}
                <span aria-hidden>·</span>{" "}
                <button
                  type="button"
                  onClick={onRetryLists}
                  className="rounded-sm text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                >
                  Retry
                </button>
              </>
            ) : (
              "Loading creatives…"
            )}
          </div>
        )}
        {creatives !== null && creatives.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Creatives">
              {creatives.map((c) => (
                <CommandItem
                  key={c.id}
                  // Use a search-friendly value with both name and product so
                  // typing either narrows in.
                  value={`${c.name} ${c.productName}`}
                  onSelect={() => go(`/library/${encodeURIComponent(c.name)}`)}
                >
                  <Images className="w-3.5 h-3.5" />
                  <span className="font-mono text-xs">{c.name}</span>
                  <span className="ml-auto text-[11px] text-ink-3">{c.productName}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        {/* Campaigns and saved views (R-027) ride the same first-open fetch. */}
        {campaigns.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Campaigns">
              {campaigns.map((c) => (
                <CommandItem
                  key={c.name}
                  // "campaign" in the value so typing the noun narrows to them.
                  value={`campaign ${c.name} ${PLATFORM_LABEL[c.platform]}`}
                  onSelect={() => go(`/campaigns/${encodeURIComponent(c.name)}`)}
                >
                  <PlatformDot platform={c.platform} size="sm" />
                  <span className="min-w-0 truncate text-xs">{c.name}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-ink-3">
                    {PLATFORM_LABEL[c.platform]}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        {views.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Saved views">
              {views.map((v) => (
                <CommandItem
                  key={v.id}
                  value={`view ${v.name} ${SAVED_VIEW_PAGE_LABEL[v.page]}`}
                  onSelect={() => go(savedViewHref(SAVED_VIEW_PATH[v.page]!, v.query, v.id))}
                >
                  <Bookmark className="w-3.5 h-3.5" />
                  <span className="min-w-0 truncate text-xs">{v.name}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-ink-3">
                    {SAVED_VIEW_PAGE_LABEL[v.page]}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
