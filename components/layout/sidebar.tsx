"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  PanelLeftClose,
  PanelLeftOpen,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  NAV_ITEMS as items,
  isActive,
  type NavItem,
} from "@/components/layout/nav-items";

const STORAGE_KEY = "sidebar-collapsed";

export function Sidebar({ role }: { role?: "admin" | "editor" | "viewer" }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  // Restore the persisted collapse preference after mount. Server renders the
  // expanded default, so there's no hydration mismatch — collapsed users see a
  // brief expanded frame, same trade-off as the theme without an inline script.
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") setCollapsed(true);
    } catch {
      /* storage disabled — stay expanded */
    }
  }, []);

  const toggle = () =>
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });

  const primary = items.filter((i) => i.group === "primary");
  const admin = role === "admin" ? items.filter((i) => i.group === "admin") : [];

  return (
    <aside
      className={cn(
        // Sticks below the (also-sticky) top bar; scrolls internally on short
        // viewports while the page content scrolls past it.
        "hidden lg:flex flex-col shrink-0 border-r border-line py-6",
        "sticky top-14 self-start h-[calc(100vh-3.5rem)] overflow-y-auto",
        "transition-[width] duration-200 ease-out",
        collapsed ? "w-16 px-2" : "w-56 px-4",
      )}
    >
      <nav className="space-y-0.5 w-full">
        {primary.map((item) =>
          item.children ? (
            <NavGroup
              key={item.label}
              item={item}
              pathname={pathname}
              collapsed={collapsed}
            />
          ) : (
            <NavLink
              key={item.href}
              item={item}
              active={isActive(pathname, item.href)}
              collapsed={collapsed}
            />
          ),
        )}
      </nav>
      {admin.length > 0 && (
        <div className="mt-8 pt-4 border-t border-line space-y-0.5 w-full">
          {!collapsed && (
            <div className="px-3 mb-1 text-eyebrow text-ink-3">
              Admin
            </div>
          )}
          {admin.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={isActive(pathname, item.href)}
              collapsed={collapsed}
            />
          ))}
        </div>
      )}
      <div className="mt-auto pt-4 border-t border-line w-full">
        <button
          type="button"
          onClick={toggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-pressed={collapsed}
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-md text-sm w-full transition-colors",
            "text-ink-2 hover:bg-surface-2 hover:text-ink",
            collapsed && "justify-center",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="w-4 h-4 shrink-0" />
          ) : (
            <PanelLeftClose className="w-4 h-4 shrink-0" />
          )}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}

function NavLink({
  item,
  active,
  collapsed,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={cn(
        "relative flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
        collapsed && "justify-center",
        active
          ? "bg-surface-2 text-ink"
          : "text-ink-2 hover:bg-surface-2 hover:text-ink",
      )}
    >
      {active && (
        <span
          className="absolute -left-3 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r"
          style={{ background: "var(--brand)" }}
          aria-hidden
        />
      )}
      <Icon className="w-4 h-4 shrink-0" />
      {!collapsed && <span>{item.label}</span>}
    </Link>
  );
}

function NavGroup({
  item,
  pathname,
  collapsed,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  const children = item.children ?? [];
  const anyActive = children.some((c) => isActive(pathname, c.href));
  const [open, setOpen] = useState(anyActive);

  // Auto-open when the user navigates into one of the section's pages.
  useEffect(() => {
    if (anyActive) setOpen(true);
  }, [anyActive]);

  // Collapsed rail has no room for the sub-list — fall back to a plain icon
  // link that jumps to the section's first page.
  if (collapsed) {
    return (
      <Link
        href={item.href}
        title={item.label}
        className={cn(
          "relative flex items-center justify-center px-3 py-2 rounded-md text-sm transition-colors",
          anyActive
            ? "bg-surface-2 text-ink"
            : "text-ink-2 hover:bg-surface-2 hover:text-ink",
        )}
      >
        <Icon className="w-4 h-4 shrink-0" />
      </Link>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "flex items-center gap-3 px-3 py-2 rounded-md text-sm w-full transition-colors",
          anyActive ? "text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
        )}
      >
        <Icon className="w-4 h-4 shrink-0" />
        <span className="flex-1 text-left">{item.label}</span>
        <ChevronRight
          className={cn(
            "w-3.5 h-3.5 shrink-0 text-ink-3 transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {open && (
        <div className="mt-0.5 space-y-0.5">
          {children.map((c) => {
            const active = isActive(pathname, c.href);
            return (
              <Link
                key={c.href}
                href={c.href}
                className={cn(
                  "relative flex items-center rounded-md text-sm transition-colors py-1.5 pl-10 pr-3",
                  active
                    ? "bg-surface-2 text-ink"
                    : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                )}
              >
                {active && (
                  <span
                    className="absolute -left-3 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r"
                    style={{ background: "var(--brand)" }}
                    aria-hidden
                  />
                )}
                {c.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
