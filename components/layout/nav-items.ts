import {
  LayoutDashboard,
  Images,
  GitCompare,
  LineChart,
  Table2,
  Upload,
  SlidersHorizontal,
  Filter,
  Megaphone,
  Users,
  ScrollText,
  KeyRound,
} from "lucide-react";
import type { Permission } from "@/lib/permissions";

/**
 * Single source of truth for the app's primary + admin navigation. Consumed by
 * both the desktop Sidebar (lg+) and the mobile Sheet nav (below lg) so the two
 * can never drift. Keep this data-only (no JSX) so either surface can render it.
 */
export interface NavChild {
  href: string;
  label: string;
}

export interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: "primary" | "admin";
  /** When present, this item is a collapsible section, not a direct link. */
  children?: NavChild[];
  /**
   * Permissions that unlock this item — shown when the user holds AT LEAST ONE.
   * Omit for items every signed-in user may see (the read-only dashboards).
   * Admins hold every permission, so they always see gated items.
   */
  perms?: Permission[];
}

export const TRENDS_CHILDREN: NavChild[] = [
  { href: "/trends/over-time", label: "Changes" },
  { href: "/trends/by-tag", label: "Tags" },
  { href: "/trends/by-type", label: "Types" },
  { href: "/trends/launches", label: "Launches" },
  { href: "/trends/video", label: "Video" },
];

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, group: "primary" },
  { href: "/creatives", label: "Creatives", icon: Images, group: "primary" },
  { href: "/summary", label: "Summary", icon: Table2, group: "primary" },
  { href: "/funnel", label: "Funnel", icon: Filter, group: "primary" },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone, group: "primary" },
  // Trends is a hub, not a page: the href is its first child (used when the
  // desktop rail is collapsed to icons and by the mobile nav's parent link).
  {
    href: "/trends/over-time",
    label: "Trends",
    icon: LineChart,
    group: "primary",
    children: TRENDS_CHILDREN,
  },
  { href: "/compare", label: "Compare", icon: GitCompare, group: "primary" },
  {
    href: "/uploads",
    label: "Uploads",
    icon: Upload,
    group: "primary",
    perms: ["upload.import", "upload.cleanup", "upload.rollback"],
  },
  {
    href: "/admin/catalog",
    label: "Configuration",
    icon: SlidersHorizontal,
    group: "admin",
    perms: [
      "catalog.products",
      "catalog.tags",
      "config.rating",
      "config.mappings",
      "config.brands",
    ],
  },
  {
    href: "/admin/access",
    label: "Access",
    icon: KeyRound,
    group: "admin",
    perms: ["users.manage"],
  },
  {
    href: "/admin/users",
    label: "Team",
    icon: Users,
    group: "admin",
    perms: ["users.manage"],
  },
  {
    href: "/admin/audit",
    label: "Audit log",
    icon: ScrollText,
    group: "admin",
    perms: ["audit.view"],
  },
];

/**
 * Nav items visible to a user holding `granted` permissions. An item with no
 * `perms` is always shown; one with `perms` needs at least one match. (Admins
 * hold every permission, so they see everything.)
 */
export function visibleNavItems(granted: Iterable<string>): NavItem[] {
  const set = granted instanceof Set ? granted : new Set(granted);
  return NAV_ITEMS.filter(
    (item) => !item.perms || item.perms.some((p) => set.has(p)),
  );
}

/** Whether a nav href matches the current pathname (exact for "/", prefix else). */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
