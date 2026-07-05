"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { NAV_ITEMS, TRENDS_CHILDREN, isActive } from "@/components/layout/nav-items";
import { cn } from "@/lib/utils";

/**
 * Below `lg` the desktop Sidebar is hidden, so this hamburger + slide-in Sheet
 * is the ONLY way to reach other pages on phone/tablet. Same nav source as the
 * sidebar (components/layout/nav-items) so the two never drift. Closes on any
 * navigation (pathname change).
 */
export function MobileNav({ role }: { role?: "admin" | "editor" | "viewer" }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the sheet whenever the route changes (link tapped).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const primary = NAV_ITEMS.filter((i) => i.group === "primary");
  const admin = role === "admin" ? NAV_ITEMS.filter((i) => i.group === "admin") : [];

  const link = (href: string, label: string, opts?: { child?: boolean }) => (
    <Link
      key={href + label}
      href={href}
      className={cn(
        "block rounded-md px-3 py-2 text-sm transition-colors",
        opts?.child && "ml-3 text-[13px]",
        isActive(pathname, href)
          ? "bg-[var(--brand-soft)] text-ink font-medium"
          : "text-ink-2 hover:bg-surface-2 hover:text-ink",
      )}
    >
      {label}
    </Link>
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Open navigation menu"
          className="lg:hidden inline-flex items-center justify-center h-9 w-9 rounded-md border border-line text-ink-2 hover:bg-surface-2 hover:text-ink transition-colors"
        >
          <Menu className="w-4.5 h-4.5" />
        </button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-0">
        <SheetHeader className="border-b border-line">
          <SheetTitle className="text-left">Navigation</SheetTitle>
        </SheetHeader>
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
          {primary.map((item) =>
            item.children ? (
              <div key={item.label} className="pt-1">
                {link(item.href, item.label)}
                {TRENDS_CHILDREN.map((c) => link(c.href, c.label, { child: true }))}
              </div>
            ) : (
              link(item.href, item.label)
            ),
          )}
          {admin.length > 0 && (
            <div className="pt-3 mt-2 border-t border-line space-y-0.5">
              <div className="px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-ink-3">
                Admin
              </div>
              {admin.map((item) => link(item.href, item.label))}
            </div>
          )}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
