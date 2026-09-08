"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Hash,
  Images,
  Package,
  Plus,
  Search,
  Settings,
  Star,
  Upload,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { navSections } from "@/components/layout/nav-items";
import { useNavTransition } from "@/lib/nav-progress";
import type { Permission } from "@/lib/permissions";

interface CreativeOption {
  id: string;
  name: string;
  productName: string;
}

interface Props {
  creatives: CreativeOption[];
  /** The viewer's permission keys — the page list is filtered by them. */
  granted: string[];
  /** Visual trigger lives in the top-bar; pass true if you want the in-line trigger style. */
  showTrigger?: boolean;
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
  /** Shown only if the user holds this permission (nav items self-gate). */
  perm?: Permission;
}> = [
  { href: "/library/new", label: "New creative", icon: Plus, perm: "creative.create" },
  { href: "/library?tab=products", label: "Library · Products", icon: Package, perm: "catalog.products" },
  { href: "/library?tab=angles", label: "Library · Angles", icon: Hash, perm: "catalog.angles" },
  { href: "/uploads/new", label: "New ad upload", icon: Upload, perm: "upload.import" },
  { href: "/uploads?tab=mapping", label: "Upload ads · CSV mapping", icon: Settings, perm: "config.mappings" },
  { href: "/store/uploads/new", label: "New order upload", icon: Upload, perm: "store.upload" },
  { href: "/store/uploads?tab=fields", label: "Upload orders · Order fields", icon: Settings, perm: "config.store" },
  { href: "/admin/catalog?tab=rating", label: "Configuration · Rate rules", icon: Star, perm: "config.rating" },
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
        // A hub item (Trends) is not itself a page — offer its children.
        if (item.children) {
          for (const c of item.children) {
            out.push({ href: c.href, label: `${item.label} · ${c.label}`, icon: item.icon });
          }
          continue;
        }
        out.push({
          href: item.href,
          // Section-qualify where the bare label would be ambiguous on its own.
          label:
            section.key === "ads" || item.label === section.label
              ? item.label
              : `${section.label} · ${item.label}`,
          icon: item.icon,
        });
      }
    }
    for (const e of EXTRA_PAGES) {
      if (!e.perm || held.has(e.perm)) out.push({ href: e.href, label: e.label, icon: e.icon });
    }
    return out;
  }, [granted]);
}

export function CommandPalette({ creatives, granted, showTrigger = true }: Props) {
  const router = useRouter();
  const [, startNav] = useNavTransition();
  const PAGES = usePages(granted);
  const [open, setOpen] = useState(false);
  // The Radix dialog generates useId-based ids; rendering it during SSR causes
  // a hydration mismatch. It's only ever opened via ⌘K / the trigger (client
  // interactions), so mount it after hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    // Through the nav transition so the global progress bar shows — jumping
    // from the palette is exactly when you can't tell whether it registered.
    startNav(() => router.push(href));
  };

  return (
    <>
      {showTrigger && (
        <button
          type="button"
          onClick={() => setOpen(true)}
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
      {mounted && (
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Type a creative name or jump to a page…" />
        <CommandList>
          <CommandEmpty>No matches.</CommandEmpty>
          <CommandGroup heading="Pages">
            {PAGES.map((p) => {
              const Icon = p.icon;
              return (
                <CommandItem
                  key={p.href}
                  value={p.label}
                  onSelect={() => go(p.href)}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {p.label}
                </CommandItem>
              );
            })}
          </CommandGroup>
          {creatives.length > 0 && (
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
                    <span className="ml-auto text-[11px] text-ink-3">
                      {c.productName}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>
      )}
    </>
  );
}
