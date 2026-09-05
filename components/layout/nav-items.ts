import {
  LayoutDashboard,
  Images,
  GitCompare,
  LineChart,
  Table2,
  Upload,
  FileUp,
  ShoppingBag,
  SlidersHorizontal,
  Filter,
  Megaphone,
  Scale,
  Wallet,
  NotebookPen,
  CalendarDays,
  History,
  Users,
  ScrollText,
} from "lucide-react";
import type { Permission } from "@/lib/permissions";

/**
 * Single source of truth for the app's navigation. Consumed by both the desktop
 * Sidebar (lg+) and the mobile Sheet nav (below lg) so the two can never drift.
 * Keep this data-only (no JSX) so either surface can render it.
 *
 * The nav is grouped into labeled SECTIONS (see `NAV_SECTIONS`): Ads (the
 * analytics/ads pages), Budget (the monthly plan module), Store (the Salla
 * order module), and Admin.
 */
export interface NavChild {
  href: string;
  label: string;
}

/** The sidebar sections, in display order. Each gets an eyebrow label. */
export const NAV_SECTIONS = [
  { key: "ads", label: "Ads" },
  { key: "budget", label: "Budget" },
  { key: "store", label: "Store" },
  { key: "admin", label: "Admin" },
] as const;
export type NavSectionKey = (typeof NAV_SECTIONS)[number]["key"];

export interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: NavSectionKey;
  /** When present, this item is a collapsible section, not a direct link. */
  children?: NavChild[];
  /**
   * Highlight only on an exact pathname match (no prefix matching). Needed for
   * an index item whose siblings live under it (e.g. Budget's Overview at
   * `/budget` next to `/budget/plan`).
   */
  exact?: boolean;
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
  // ── Ads ──────────────────────────────────────────────────────────────────
  { href: "/", label: "Dashboard", icon: LayoutDashboard, group: "ads" },
  { href: "/creatives", label: "Creatives", icon: Images, group: "ads" },
  { href: "/summary", label: "Summary", icon: Table2, group: "ads" },
  { href: "/funnel", label: "Funnel", icon: Filter, group: "ads" },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone, group: "ads" },
  // Trends is a hub, not a page: the href is its first child (used when the
  // desktop rail is collapsed to icons and by the mobile nav's parent link).
  {
    href: "/trends/over-time",
    label: "Trends",
    icon: LineChart,
    group: "ads",
    children: TRENDS_CHILDREN,
  },
  { href: "/compare", label: "Compare", icon: GitCompare, group: "ads" },
  {
    href: "/uploads",
    label: "Uploads",
    icon: Upload,
    group: "ads",
    perms: ["upload.import", "upload.cleanup", "upload.rollback"],
  },

  // ── Budget ───────────────────────────────────────────────────────────────
  // Monthly plan-vs-actual (open to any brand member; editing is permission-
  // gated behind budget.manage on the Plan page). Overview is the section's
  // index route, so it matches exactly — otherwise it would stay lit on every
  // sibling page.
  { href: "/budget", label: "Overview", icon: Wallet, group: "budget", exact: true },
  { href: "/budget/plan", label: "Plan", icon: NotebookPen, group: "budget" },
  { href: "/budget/daily", label: "Daily", icon: CalendarDays, group: "budget" },
  { href: "/budget/history", label: "History", icon: History, group: "budget" },

  // ── Store ────────────────────────────────────────────────────────────────
  {
    // The upload surface (history + new). Prefix-matches /store/uploads/new so
    // the "Upload orders" item stays highlighted on the new-upload page.
    href: "/store/uploads",
    label: "Upload orders",
    icon: FileUp,
    group: "store",
    perms: ["store.upload", "upload.rollback"],
  },
  {
    // The orders table — open to any brand member, like the ads data pages.
    href: "/store/orders",
    label: "Orders",
    icon: ShoppingBag,
    group: "store",
  },
  {
    // Store order counts vs platform-claimed conversions, per day — open to any
    // signed-in brand member, like the other analytics pages.
    href: "/store/reconciliation",
    label: "Reconciliation",
    icon: Scale,
    group: "store",
  },

  // ── Admin ────────────────────────────────────────────────────────────────
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

/**
 * The visible nav grouped into its sections (label + items), in display order.
 * Sections with no visible items are dropped. Both navs render from this so the
 * section grouping lives in ONE place.
 */
export function navSections(
  granted: Iterable<string>,
): Array<{ key: NavSectionKey; label: string; items: NavItem[] }> {
  const items = visibleNavItems(granted);
  return NAV_SECTIONS.map((s) => ({
    key: s.key,
    label: s.label,
    items: items.filter((i) => i.group === s.key),
  })).filter((s) => s.items.length > 0);
}

/** Whether a nav href matches the current pathname (exact for "/", prefix else). */
export function isActive(pathname: string, href: string, exact?: boolean): boolean {
  if (href === "/" || exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

const MONTH_PARAM = /^\d{4}-\d{2}$/;

/**
 * The href a nav item should link to given where the user is. Budget items
 * carry the current `?month=` while the user is inside the Budget section, so
 * switching between Overview / Plan / Daily / History never loses the month.
 * Everything else links plain.
 */
export function navItemHref(
  item: Pick<NavItem, "href" | "group">,
  pathname: string,
  search: { get(name: string): string | null } | null,
): string {
  if (item.group !== "budget" || !pathname.startsWith("/budget")) return item.href;
  const month = search?.get("month");
  if (!month || !MONTH_PARAM.test(month)) return item.href;
  return `${item.href}?month=${month}`;
}
