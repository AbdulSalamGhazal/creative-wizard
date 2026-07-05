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
} from "lucide-react";

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
  { href: "/uploads", label: "Uploads", icon: Upload, group: "primary" },
  { href: "/admin/catalog", label: "Configuration", icon: SlidersHorizontal, group: "admin" },
  { href: "/admin/users", label: "Team", icon: Users, group: "admin" },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText, group: "admin" },
];

/** Whether a nav href matches the current pathname (exact for "/", prefix else). */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
