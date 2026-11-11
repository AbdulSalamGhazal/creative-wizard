"use client";

import { useState, type MouseEvent } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BrandStyle } from "@/lib/brand-style";
import { BrandMark } from "@/components/account/brand-mark";
import { switchTarget, type SwitchTarget } from "@/lib/brand-path";
import { currentAppPathname, useRouter } from "@/lib/brand-nav";
import { useNavTransition } from "@/lib/nav-progress";
import { isPlainClick } from "@/lib/shallow-url";

interface Props {
  accounts: BrandStyle[];
  activeId: string;
}

/**
 * Brand switcher in the top bar (2026-11: the brand is in the URL, per TAB).
 * Each brand is a real LINK to the same page under that brand's address, so
 * switching moves only THIS tab, and ⌘/middle-click opens the other brand in
 * a new tab beside it. On a page that only exists in the current brand (a
 * creative's or campaign's own page) the link goes to that section's list
 * instead, and a toast says why (`switchTarget`, lib/brand-path.ts).
 * Membership is checked server-side; only allowed brands are listed.
 */
export function AccountSwitcher({ accounts, activeId }: Props) {
  const router = useRouter();
  const [pending, startNav] = useNavTransition();
  const [open, setOpen] = useState(false);
  // Targets are read from the address bar when the menu opens — always the
  // page as it is now, filters included.
  const [targets, setTargets] = useState<Record<string, SwitchTarget>>({});

  const active = accounts.find((a) => a.id === activeId) ?? accounts[0];
  if (!active) return null;

  function onOpenChange(next: boolean) {
    if (next) {
      const path = currentAppPathname();
      const search = window.location.search;
      setTargets(
        Object.fromEntries(
          accounts.map((a) => [
            a.id,
            // This tab's own brand links to the page as it is (⌘-click = a
            // copy of this tab); every other brand to `switchTarget`.
            a.id === activeId
              ? { href: `${window.location.pathname}${search}`, moved: null }
              : switchTarget(a.slug, path, search),
          ]),
        ),
      );
    }
    setOpen(next);
  }

  function go(e: MouseEvent<HTMLAnchorElement>, brand: BrandStyle, target: SwitchTarget) {
    if (!isPlainClick(e)) return; // new tab / window: the browser follows the href
    e.preventDefault();
    setOpen(false);
    if (brand.id === activeId) return;
    if (target.moved) {
      toast(`Showing ${brand.name}’s ${target.moved.section}`, {
        description: `That ${target.moved.what} is in ${active!.name}.`,
      });
    }
    startNav(() => router.push(target.href));
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Switch brand"
          aria-label={`Brand: ${active.name}. Switch brand`}
          // `min-w-0` lets the trigger shrink when the top bar runs out of
          // room: the brand NAME truncates instead of the bar overflowing.
          className="flex min-w-0 items-center gap-1.5 rounded-md border border-line py-1 pl-1 pr-2 text-xs font-medium text-ink-2 hover:text-ink hover:bg-surface-2 transition"
        >
          <BrandMark brand={active} size="md" />
          {/* A floor under the name (R-060): the brand is the most
              consequential context in the app, so a crowded phone bar may
              truncate it but never to "Ur…". The chevron is the first to go
              below sm — the bordered pill already reads as a control. */}
          <span className="min-w-[2.75rem] max-w-[140px] truncate">{active.name}</span>
          {pending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          ) : (
            <ChevronsUpDown className="hidden w-3.5 h-3.5 shrink-0 opacity-60 sm:block" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 max-h-[60vh] overflow-y-auto">
        <DropdownMenuLabel>Brand</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {accounts.map((a) => {
          const target = targets[a.id] ?? { href: `/${a.slug}`, moved: null };
          const current = a.id === activeId;
          return (
            <DropdownMenuItem key={a.id} asChild className="gap-2">
              <a
                href={target.href}
                aria-current={current ? "page" : undefined}
                onClick={(e) => go(e, a, target)}
              >
                <Check className={current ? "w-4 h-4 shrink-0" : "w-4 h-4 shrink-0 opacity-0"} />
                <BrandMark brand={a} size="sm" />
                <span className="truncate">{a.name}</span>
              </a>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
