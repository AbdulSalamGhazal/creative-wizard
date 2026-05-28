"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  GitCompare,
  Hash,
  Images,
  Layers3,
  LayoutDashboard,
  LineChart,
  Package,
  Plus,
  Rocket,
  ScrollText,
  Search,
  Settings,
  Upload,
  Users,
  Video,
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

interface CreativeOption {
  id: string;
  name: string;
  productName: string;
}

interface Props {
  creatives: CreativeOption[];
  /** Visual trigger lives in the top-bar; pass true if you want the in-line trigger style. */
  showTrigger?: boolean;
}

const PAGES = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/creatives", label: "Creatives library", icon: Images },
  { href: "/creatives/new", label: "New creative", icon: Plus },
  { href: "/trends", label: "Trends", icon: LineChart },
  { href: "/trends/over-time", label: "Trends · Over time", icon: LineChart },
  { href: "/trends/by-tag", label: "Trends · By tag", icon: Hash },
  { href: "/trends/launches", label: "Trends · Launches", icon: Rocket },
  { href: "/trends/video", label: "Trends · Video diagnostics", icon: Video },
  { href: "/compare", label: "Compare creatives", icon: GitCompare },
  { href: "/platforms", label: "By platform", icon: Layers3 },
  { href: "/uploads", label: "Upload history", icon: Upload },
  { href: "/uploads/new", label: "New upload", icon: Upload },
  { href: "/admin/products", label: "Products", icon: Package },
  { href: "/admin/users", label: "Team", icon: Users },
  { href: "/admin/platforms", label: "CSV mapping", icon: Settings },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
] as const;

export function CommandPalette({ creatives, showTrigger = true }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

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
    router.push(href);
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
                    onSelect={() => go(`/creatives/${encodeURIComponent(c.name)}`)}
                  >
                    <Images className="w-3.5 h-3.5" />
                    <span className="font-mono text-[13px]">{c.name}</span>
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
    </>
  );
}
