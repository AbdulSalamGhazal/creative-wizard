"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Images,
  GitCompare,
  Layers3,
  Upload,
  Package,
  Users,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: "primary" | "admin";
}

const items: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard, group: "primary" },
  { href: "/creatives", label: "Creatives", icon: Images, group: "primary" },
  { href: "/compare", label: "Compare", icon: GitCompare, group: "primary" },
  { href: "/platforms", label: "Platforms", icon: Layers3, group: "primary" },
  { href: "/uploads", label: "Uploads", icon: Upload, group: "primary" },
  { href: "/admin/platforms", label: "CSV mapping", icon: Layers3, group: "admin" },
  { href: "/admin/products", label: "Products", icon: Package, group: "admin" },
  { href: "/admin/users", label: "Team", icon: Users, group: "admin" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ role }: { role?: "admin" | "editor" | "viewer" }) {
  const pathname = usePathname();
  const primary = items.filter((i) => i.group === "primary");
  const admin = role === "admin" ? items.filter((i) => i.group === "admin") : [];

  return (
    <aside className="hidden lg:flex flex-col w-56 px-4 py-6 border-r border-line min-h-[calc(100vh-3.5rem)]">
      <nav className="space-y-0.5">
        {primary.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
        ))}
      </nav>
      {admin.length > 0 && (
        <div className="mt-8 pt-4 border-t border-line space-y-0.5">
          <div className="px-3 mb-1 text-[10px] uppercase tracking-[0.18em] text-ink-3">
            Admin
          </div>
          {admin.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={isActive(pathname, item.href)}
            />
          ))}
        </div>
      )}
      <div className="mt-auto pt-4 border-t border-line">
        <NavLink
          item={{
            href: "/settings",
            label: "Settings",
            icon: Settings,
            group: "primary",
          }}
          active={isActive(pathname, "/settings")}
        />
      </div>
    </aside>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "relative flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
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
      <Icon className="w-4 h-4" />
      <span>{item.label}</span>
    </Link>
  );
}
