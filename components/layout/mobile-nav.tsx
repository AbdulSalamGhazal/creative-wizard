"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Menu } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  isActive,
  navSections,
  sectionForPath,
} from "@/components/layout/nav-items";
import { useOpenSection } from "@/components/layout/use-open-section";
import { NavSectionToggle } from "@/components/layout/nav-section-toggle";
import {
  useNavLinkProps,
  type NavLinkProps,
} from "@/components/layout/use-nav-link";
import { cn } from "@/lib/utils";

/**
 * Below `lg` the desktop Sidebar is hidden, so this hamburger + slide-in Sheet
 * is the ONLY way to reach other pages on phone/tablet. Same nav source as the
 * sidebar (components/layout/nav-items) so the two never drift. Closes on any
 * navigation (pathname change).
 */
export function MobileNav({ granted }: { granted: string[] }) {
  const pathname = usePathname();
  // Budget links carry the current ?month= — the href is progressive
  // enhancement (hence the <Suspense> the TopBar wraps this in for
  // useSearchParams); the click handler re-derives it from window.location so
  // the month survives regardless of hydration timing. See use-nav-link.ts.
  const searchParams = useSearchParams();
  const linkProps = useNavLinkProps(pathname, searchParams);
  const [open, setOpen] = useState(false);

  // Close the sheet whenever the route changes (link tapped).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // …and when the tapped link is the page already showing: no route change
  // comes to close it, so the tap would otherwise look like it did nothing.
  const closeIfHere = (href: string) => {
    if (href.split("?")[0] === pathname) setOpen(false);
  };

  const sections = navSections(granted);
  // The same accordion as the desktop sidebar: one section open at a time,
  // the current page's by default (2026-11-08).
  const [openSection, toggleSection] = useOpenSection(sections, pathname);
  const currentSection = sectionForPath(sections, pathname);

  // ONE look with the desktop sidebar (R-035/R-042): the item's icon, and
  // "you are here" is surface-2 + the 2px brand bar at the edge — never the
  // brand-soft fill, which means "filter applied" everywhere else.
  const link = (
    href: string,
    label: string,
    opts?: {
      child?: boolean;
      exact?: boolean;
      link?: NavLinkProps;
      icon?: React.ComponentType<{ className?: string }>;
    },
  ) => {
    const active = isActive(pathname, href, opts?.exact);
    const Icon = opts?.icon;
    return (
      <Link
        key={href + label}
        href={opts?.link?.href ?? href}
        onClick={(e) => {
          opts?.link?.onClick?.(e);
          closeIfHere(href);
        }}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
          // Children sit under the hub's label, as on the desktop sidebar.
          opts?.child && "py-1.5 pl-10",
          active ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
        )}
      >
        {active && (
          <span
            className="absolute -left-3 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-sm bg-brand"
            aria-hidden
          />
        )}
        {Icon && <Icon className="h-4 w-4 shrink-0" />}
        {label}
      </Link>
    );
  };

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
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
          {sections.map((section, si) => {
            const listId = `mobile-nav-section-${section.key}`;
            const open = openSection === section.key;
            return (
              <div
                key={section.key}
                className={cn("space-y-0.5", si > 0 && "border-t border-line pt-1")}
              >
                <NavSectionToggle
                  icon={section.icon}
                  label={section.label}
                  open={open}
                  current={currentSection === section.key}
                  controls={listId}
                  onToggle={() => toggleSection(section.key)}
                  // A finger-sized row on the phone, like the links under it.
                  className="py-2.5"
                />
                {open && (
                  <div id={listId} className="space-y-0.5 pb-2 pl-3">
                    {section.items.map((item) =>
                      item.children ? (
                        // The hub is a HEADING, not a link (R-042): it pointed
                        // at its own first child, so two adjacent entries lit
                        // up together. Desktop shows it as a disclosure; here
                        // its pages are always listed under it.
                        <div key={item.label} role="group" aria-label={item.label}>
                          <div
                            className={cn(
                              "flex items-center gap-3 px-3 py-2 text-sm",
                              item.children.some((c) => isActive(pathname, c.href))
                                ? "text-ink"
                                : "text-ink-2",
                            )}
                          >
                            <item.icon className="h-4 w-4 shrink-0" />
                            {item.label}
                          </div>
                          {item.children.map((c) =>
                            link(c.href, c.label, { child: true }),
                          )}
                        </div>
                      ) : (
                        link(item.href, item.label, {
                          exact: item.exact,
                          link: linkProps(item),
                          icon: item.icon,
                        })
                      ),
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
