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
  Layers,
  Megaphone,
  Scale,
  Wallet,
  CalendarDays,
  ClipboardCheck,
  NotebookPen,
  Gauge,
  Users,
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
  Receipt,
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
  /** Its keyboard shortcut — the hub's key then its own (`nav-shortcuts.ts`). */
  keys: string;
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
  { key: "ads", label: "Advertisements", icon: MonitorPlay, shortcut: "g" },
  { key: "budget", label: "Budget", icon: DollarSign, shortcut: "b" },
  { key: "store", label: "Store", icon: Store, shortcut: "s" },
  // The module is "Price Structure" in code and URLs; its NAME is Pricing
  // (user, 2026-11-08) — labels, eyebrows, tab titles, the Team page.
  { key: "pricing", label: "Pricing", icon: Calculator, shortcut: "p" },
  { key: "admin", label: "Admin", icon: Shield, shortcut: "a" },
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
   * Its keyboard shortcut: the section's `shortcut` then its own letter
   * ("bp" = B then P → Budget · Plan; user-approved key map, 2026-11-22). A
   * hub has none — its `hubShortcut` leads its children's `keys`.
   */
  keys?: string;
  /** A hub's own first key (Analyzers: T). */
  hubShortcut?: string;
  /**
   * Highlight only on an exact pathname match (no prefix matching). Needed for
   * an index item whose siblings live under it (e.g. Budget's Today at
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
  { href: "/compare", label: "Compare", keys: "tc" },
  { href: "/trends/over-time", label: "Changes", keys: "th" },
  { href: "/trends/by-angle", label: "Angles", keys: "ta" },
  { href: "/trends/by-type", label: "Types", keys: "ty" },
  { href: "/trends/launches", label: "Launches", keys: "tl" },
  { href: "/trends/video", label: "Video", keys: "tv" },
  // Performance by the landing page an ad sent traffic to (its ` @code`).
  { href: "/trends/landing-pages", label: "LPs", keys: "tp" },
];

export const NAV_ITEMS: NavItem[] = [
  // ── Advertisements ───────────────────────────────────────────────────────
  // Order (user, 2026-11-08): Dashboard · Library · Ads · Campaigns · Canvas ·
  // Funnel · Analyzers · Upload ads.
  { href: "/", label: "Dashboard", icon: LayoutDashboard, group: "ads", keys: "gd" },
  { href: "/library", label: "Library", icon: Images, group: "ads", keys: "gl" },
  { href: "/summary", label: "Ads", icon: Table2, group: "ads", keys: "ga" },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone, group: "ads", keys: "gc" },
  // The level under a campaign (2026-11, user decision: its own sidebar item).
  // "s" for sets — "a" is Ads.
  { href: "/ad-sets", label: "Ad sets", icon: Layers, group: "ads", keys: "gs" },
  // The campaign↔creative graph — read-only, sits with the two things it joins.
  { href: "/canvas", label: "Canvas", icon: Workflow, group: "ads", keys: "gn" },
  { href: "/funnel", label: "Funnel", icon: Filter, group: "ads", keys: "gf" },
  // Analyzers is a hub, not a page: the href is its first child (used when the
  // desktop rail is collapsed to icons).
  {
    href: ANALYZERS_CHILDREN[0]!.href,
    label: "Analyzers",
    icon: LineChart,
    group: "ads",
    children: ANALYZERS_CHILDREN,
    hubShortcut: "t",
  },
  {
    href: "/uploads",
    keys: "gu",
    label: "Upload ads",
    icon: Upload,
    group: "ads",
    perms: [...NAV_ROUTE_GATES["/uploads"]],
  },

  // ── Budget ───────────────────────────────────────────────────────────────
  // Monthly plan-vs-actual (open to any brand member; editing is permission-
  // gated behind budget.manage on the Plan page). Today is the section's
  // index route, so it matches exactly — otherwise it would stay lit on every
  // sibling page. (Today replaced the Overview, 2026-11-14.)
  { href: "/budget", label: "Today", icon: Wallet, group: "budget", keys: "bt", exact: true },
  // Day pacing: any day against that day's plan (2026-11-14).
  { href: "/budget/days", label: "Daily", icon: CalendarDays, group: "budget", keys: "bd" },
  // Analysis is the range page (it was Pacing until 2026-11-14): pacing and
  // results for any dates. /budget/pacing and /budget/tracker redirect here.
  { href: "/budget/analysis", label: "Analysis", icon: Gauge, group: "budget", keys: "ba" },
  // The manager's page: months compared, plan accuracy, who changed what.
  { href: "/budget/review", label: "Review", icon: ClipboardCheck, group: "budget", keys: "br" },
  { href: "/budget/plan", label: "Plan", icon: NotebookPen, group: "budget", keys: "bp" },

  // ── Store ────────────────────────────────────────────────────────────────
  {
    // The orders table — open to any brand member, like the ads data pages.
    href: "/store/orders",
    keys: "so",
    label: "Orders",
    icon: ShoppingBag,
    group: "store",
  },
  {
    // What the orders themselves say (volume, revenue, AOV, breakdowns) —
    // store facts only, no ads side. Sits BETWEEN the raw table and the
    // ads-vs-store comparison, which is the order you read them in.
    href: "/store/insights",
    keys: "si",
    label: "Insights",
    icon: ChartPie,
    group: "store",
  },
  {
    // Where orders come from by UTM source, and how each platform's claimed
    // conversions compare with the orders its UTMs show. Sits after Insights
    // (store facts) and before Reconciliation (the per-day tables).
    href: "/store/utms",
    keys: "sm",
    label: "UTMs",
    icon: Tags,
    group: "store",
  },
  {
    // Store order counts vs platform-claimed conversions, per day — open to any
    // signed-in brand member, like the other analytics pages.
    href: "/store/reconciliation",
    keys: "sr",
    label: "Reconciliation",
    icon: Scale,
    group: "store",
  },
  {
    // What each product costs, per unit, from a day (2026-11-23) — the COGS
    // input. Read-open; editing needs config.store. Before the upload tool,
    // which stays last.
    href: "/store/costs",
    keys: "sc",
    label: "Product costs",
    icon: Receipt,
    group: "store",
  },
  {
    // The upload surface (history + new). LAST in the section, like "Upload
    // ads" in Ads — read pages first, the ingest tool last (R-094,
    // 2026-11-07). Prefix-matches /store/uploads/new so the item stays
    // highlighted on the new-upload page.
    href: "/store/uploads",
    keys: "su",
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
    keys: "po",
    label: "Overview",
    icon: Coins,
    group: "pricing",
    perms: [...NAV_ROUTE_GATES["/price-structure/overview"]],
  },
  {
    href: "/price-structure/plan",
    keys: "pp",
    label: "Plan",
    icon: TrendingUp,
    group: "pricing",
    perms: [...NAV_ROUTE_GATES["/price-structure/plan"]],
  },
  {
    href: "/price-structure/actual",
    keys: "pa",
    label: "Actual",
    icon: Wallet,
    group: "pricing",
    perms: [...NAV_ROUTE_GATES["/price-structure/actual"]],
  },
  {
    href: "/price-structure/products",
    keys: "px",
    label: "Products & offers",
    icon: Package,
    group: "pricing",
    perms: [...NAV_ROUTE_GATES["/price-structure/products"]],
  },
  {
    href: "/price-structure/targets",
    keys: "pt",
    label: "Targets",
    icon: Target,
    group: "pricing",
    perms: [...NAV_ROUTE_GATES["/price-structure/targets"]],
  },

  // ── Admin ────────────────────────────────────────────────────────────────
  {
    href: "/admin/catalog",
    keys: "ac",
    label: "Configuration",
    icon: SlidersHorizontal,
    group: "admin",
    // Anyone who can open at least one of its tabs (D18) — editors see it for
    // Exclusions; a Library-tab permission alone no longer leads to a 404.
    perms: [...NAV_ROUTE_GATES["/admin/catalog"]],
  },
  {
    href: "/admin/users",
    keys: "am",
    label: "Team",
    icon: Users,
    group: "admin",
    perms: [...NAV_ROUTE_GATES["/admin/users"]],
  },
  {
    href: "/admin/audit",
    keys: "al",
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
 * Budget keeps `?month=` across its pages, Price structure keeps
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
 * switching between Budget's pages never loses the month; Price
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
