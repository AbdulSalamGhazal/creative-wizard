import {
  ChartPie,
  LayoutDashboard,
  Images,
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
  Gauge,
  Users,
  UsersRound,
  ScrollText,
  Tags,
  Workflow,
  Coins,
  Package,
  Target,
  TrendingUp,
  MonitorPlay,
  DollarSign,
  Store,
  Calculator,
  Shield,
} from "lucide-react";
import type { Permission } from "@/lib/permissions";
import { NAV_ROUTE_GATES } from "@/lib/page-gates";

/**
 * Single source of truth for the app's navigation. Consumed by both the desktop
 * Sidebar (lg+) and the mobile Sheet nav (below lg) so the two can never drift.
 * Keep this data-only (no JSX) so either surface can render it.
 *
 * The nav is grouped into labeled SECTIONS (see `NAV_SECTIONS`):
 * Advertisements (the analytics/ads pages), Budget (the monthly plan module),
 * Store (the Salla order module), Price structure, and Admin. The sections are
 * an ACCORDION in both navs — one open at a time, the current page's section
 * by default (`sectionForPath`, 2026-11-08).
 */
export interface NavChild {
  href: string;
  label: string;
}

/**
 * The sidebar sections, in display order. Each header is its icon + label
 * (design A, 2026-11-08): the icons are the SECTION's own and never repeat an
 * item's — Campaigns already wears the megaphone, so Advertisements is the
 * play-screen.
 */
export const NAV_SECTIONS = [
  // The key stays "ads" (it is a code name, read by qualifiedNavLabel and the
  // tests); only the visible label is the long form (2026-11-08).
  { key: "ads", label: "Advertisements", icon: MonitorPlay },
  { key: "budget", label: "Budget", icon: DollarSign },
  { key: "store", label: "Store", icon: Store },
  // The module is "Price Structure" in code and URLs; its NAME is Pricing
  // (user, 2026-11-08) — labels, eyebrows, tab titles, the Team page.
  { key: "pricing", label: "Pricing", icon: Calculator },
  { key: "admin", label: "Admin", icon: Shield },
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
   * Admins hold every permission, so they always see gated items. NEVER a
   * hand-written list: a gated item reads its route's `NAV_ROUTE_GATES`
   * entry, derived from the page's own tab and action gates (D18).
   */
  perms?: Permission[];
}

/**
 * The Analyzers hub (was "Trends", 2026-11-08): Compare first, then the six
 * trend pages. URLs did NOT move — `/compare` and `/trends/*` are what saved
 * links and comment anchors point at.
 */
export const ANALYZERS_CHILDREN: NavChild[] = [
  { href: "/compare", label: "Compare" },
  { href: "/trends/over-time", label: "Changes" },
  { href: "/trends/by-angle", label: "Angles" },
  { href: "/trends/by-type", label: "Types" },
  { href: "/trends/launches", label: "Launches" },
  { href: "/trends/video", label: "Video" },
  // Performance by the landing page an ad sent traffic to (its ` @code`).
  { href: "/trends/landing-pages", label: "LPs" },
];

export const NAV_ITEMS: NavItem[] = [
  // ── Advertisements ───────────────────────────────────────────────────────
  // Order (user, 2026-11-08): Dashboard · Library · Ads · Campaigns · Canvas ·
  // Funnel · Analyzers · Upload ads.
  { href: "/", label: "Dashboard", icon: LayoutDashboard, group: "ads" },
  { href: "/library", label: "Library", icon: Images, group: "ads" },
  { href: "/summary", label: "Ads", icon: Table2, group: "ads" },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone, group: "ads" },
  // The campaign↔creative graph — read-only, sits with the two things it joins.
  { href: "/canvas", label: "Canvas", icon: Workflow, group: "ads" },
  { href: "/funnel", label: "Funnel", icon: Filter, group: "ads" },
  // Analyzers is a hub, not a page: the href is its first child (used when the
  // desktop rail is collapsed to icons).
  {
    href: ANALYZERS_CHILDREN[0]!.href,
    label: "Analyzers",
    icon: LineChart,
    group: "ads",
    children: ANALYZERS_CHILDREN,
  },
  {
    href: "/uploads",
    label: "Upload ads",
    icon: Upload,
    group: "ads",
    perms: [...NAV_ROUTE_GATES["/uploads"]],
  },

  // ── Budget ───────────────────────────────────────────────────────────────
  // Monthly plan-vs-actual (open to any brand member; editing is permission-
  // gated behind budget.manage on the Plan page). Overview is the section's
  // index route, so it matches exactly — otherwise it would stay lit on every
  // sibling page.
  { href: "/budget", label: "Overview", icon: Wallet, group: "budget", exact: true },
  { href: "/budget/plan", label: "Plan", icon: NotebookPen, group: "budget" },
  // Pacing carries the board the Tracker used to be (merged 2026-10-19);
  // /budget/tracker redirects here.
  { href: "/budget/pacing", label: "Pacing", icon: Gauge, group: "budget" },
  // Funnel-audience sizes vs spend. Open to any brand member, like the other
  // read surfaces; recording is gated behind audience.manage on the page.
  { href: "/budget/audience", label: "Audience", icon: UsersRound, group: "budget" },

  // ── Store ────────────────────────────────────────────────────────────────
  {
    // The orders table — open to any brand member, like the ads data pages.
    href: "/store/orders",
    label: "Orders",
    icon: ShoppingBag,
    group: "store",
  },
  {
    // What the orders themselves say (volume, revenue, AOV, breakdowns) —
    // store facts only, no ads side. Sits BETWEEN the raw table and the
    // ads-vs-store comparison, which is the order you read them in.
    href: "/store/insights",
    label: "Insights",
    icon: ChartPie,
    group: "store",
  },
  {
    // Where orders come from by UTM source, and how each platform's claimed
    // conversions compare with the orders its UTMs show. Sits after Insights
    // (store facts) and before Reconciliation (the per-day tables).
    href: "/store/utms",
    label: "UTMs",
    icon: Tags,
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
  {
    // The upload surface (history + new). LAST in the section, like "Upload
    // ads" in Ads — read pages first, the ingest tool last (R-094,
    // 2026-11-07). Prefix-matches /store/uploads/new so the item stays
    // highlighted on the new-upload page.
    href: "/store/uploads",
    label: "Upload orders",
    icon: FileUp,
    group: "store",
    perms: [...NAV_ROUTE_GATES["/store/uploads"]],
  },

  // ── Price structure ──────────────────────────────────────────────────────
  // Offer pricing → Clean Money Left → the ROAS each offer and mix needs
  // (2026-11). ONE permission opens the whole module, so every entry carries
  // the same derived gate; Versions is reached from the page header's picker,
  // not from here. Links carry the open version (`?v=`) like Budget's month.
  {
    href: "/price-structure/overview",
    label: "Overview",
    icon: Coins,
    group: "pricing",
    perms: [...NAV_ROUTE_GATES["/price-structure/overview"]],
  },
  {
    href: "/price-structure/plan",
    label: "Plan",
    icon: TrendingUp,
    group: "pricing",
    perms: [...NAV_ROUTE_GATES["/price-structure/plan"]],
  },
  {
    href: "/price-structure/products",
    label: "Products & offers",
    icon: Package,
    group: "pricing",
    perms: [...NAV_ROUTE_GATES["/price-structure/products"]],
  },
  {
    href: "/price-structure/targets",
    label: "Targets",
    icon: Target,
    group: "pricing",
    perms: [...NAV_ROUTE_GATES["/price-structure/targets"]],
  },

  // ── Admin ────────────────────────────────────────────────────────────────
  {
    href: "/admin/catalog",
    label: "Configuration",
    icon: SlidersHorizontal,
    group: "admin",
    // Anyone who can open at least one of its tabs (D18) — editors see it for
    // Exclusions; a Library-tab permission alone no longer leads to a 404.
    perms: [...NAV_ROUTE_GATES["/admin/catalog"]],
  },
  {
    href: "/admin/users",
    label: "Team",
    icon: Users,
    group: "admin",
    perms: [...NAV_ROUTE_GATES["/admin/users"]],
  },
  {
    href: "/admin/audit",
    label: "Audit log",
    icon: ScrollText,
    group: "admin",
    perms: [...NAV_ROUTE_GATES["/admin/audit"]],
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
): Array<{
  key: NavSectionKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: NavItem[];
}> {
  const items = visibleNavItems(granted);
  return NAV_SECTIONS.map((s) => ({
    key: s.key,
    label: s.label,
    icon: s.icon,
    items: items.filter((i) => i.group === s.key),
  })).filter((s) => s.items.length > 0);
}

/**
 * An item's label where it must stand ALONE — the ⌘K palette's page list and
 * the collapsed rail's tooltip (R-088): section-qualified ("Budget ·
 * Overview", "Pricing · Plan") except in Ads, the default section, or
 * where the item already IS the section's name. One rule for both.
 */
export function qualifiedNavLabel(
  section: { key: NavSectionKey; label: string },
  itemLabel: string,
): string {
  return section.key === "ads" || itemLabel === section.label
    ? itemLabel
    : `${section.label} · ${itemLabel}`;
}

/**
 * The section the current page lives in — the one the accordion opens by
 * default. Checks every item and every hub child (the hub's own href is just
 * its first child's). `null` for a page outside the nav (Notifications, a
 * creative's detail page under no item…), where the caller falls back to the
 * first section.
 */
export function sectionForPath(
  sections: ReadonlyArray<{ key: NavSectionKey; items: NavItem[] }>,
  pathname: string,
): NavSectionKey | null {
  for (const section of sections) {
    for (const item of section.items) {
      if (item.children) {
        if (item.children.some((c) => isActive(pathname, c.href))) return section.key;
      } else if (isActive(pathname, item.href, item.exact)) {
        return section.key;
      }
    }
  }
  return null;
}

/** Whether a nav href matches the current pathname (exact for "/", prefix else). */
export function isActive(pathname: string, href: string, exact?: boolean): boolean {
  if (href === "/" || exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

const MONTH_PARAM = /^\d{4}-\d{2}$/;
const UUID_PARAM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The sections whose links carry a URL param while the user is inside them:
 * Budget keeps `?month=` across Overview / Plan / Pacing, Price structure keeps
 * the open version `?v=` across its four pages (each browser tab has its own
 * version open — brief §7). A value that fails the shape is dropped.
 */
export const CARRIED_PARAMS: Partial<
  Record<NavSectionKey, { prefix: string; param: string; shape: RegExp }>
> = {
  budget: { prefix: "/budget", param: "month", shape: MONTH_PARAM },
  pricing: { prefix: "/price-structure", param: "v", shape: UUID_PARAM },
};

/** Whether a section's links are resolved at click time (see use-nav-link.ts). */
export function carriesParam(group: NavSectionKey): boolean {
  return CARRIED_PARAMS[group] !== undefined;
}

/**
 * The href a nav item should link to given where the user is. Budget items
 * carry the current `?month=` while the user is inside the Budget section, so
 * switching between Overview / Plan / Pacing never loses the month; Price
 * structure items carry `?v=` the same way. Everything else links plain.
 */
export function navItemHref(
  item: Pick<NavItem, "href" | "group">,
  pathname: string,
  search: { get(name: string): string | null } | null,
): string {
  const carried = CARRIED_PARAMS[item.group];
  if (!carried || !pathname.startsWith(carried.prefix)) return item.href;
  const value = search?.get(carried.param);
  if (!value || !carried.shape.test(value)) return item.href;
  return `${item.href}?${carried.param}=${value}`;
}
