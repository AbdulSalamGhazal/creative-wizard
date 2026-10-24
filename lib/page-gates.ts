import type { Permission } from "@/lib/permissions";

/**
 * WHO MAY OPEN WHAT — the gates of every permission-gated page and tab, in a
 * plain module that the pages, the sidebar and the ⌘K palette all read
 * (D18, 2026-10). The sidebar's permission lists used to be hand-copied and
 * had drifted from the pages: every editor holds `record.exclude` but had no
 * route to Configuration → Exclusions (the page "Excluded by rule" sends them
 * to), while a user holding only `catalog.products` saw "Configuration" and
 * landed on a 404 — that tab had moved to the Library. Now a nav item's
 * permissions are DERIVED from its page's gates, so the two cannot disagree;
 * `components/layout/nav-gates.test.ts` pins it.
 *
 * A gate is `null` (every brand member), one permission, or a list meaning
 * ANY of them. Admins pass every gate (`can()` bypasses below admin).
 */
export type Gate = Permission | readonly Permission[] | null;

export interface GatedTab {
  key: string;
  label: string;
  perm: Gate;
}

/** Does a holder of `has` pass `gate`? */
export function passes(gate: Gate, has: (perm: Permission) => boolean): boolean {
  if (gate === null) return true;
  return typeof gate === "string" ? has(gate) : gate.some((p) => has(p));
}

/** Every permission that opens at least one of `gates` (deduped, in order). */
export function gatePermissions(gates: readonly Gate[]): Permission[] {
  const out: Permission[] = [];
  for (const g of gates) {
    if (g === null) continue;
    for (const p of typeof g === "string" ? [g] : g) if (!out.includes(p)) out.push(p);
  }
  return out;
}

// ── Library (/library) — open to every member; three tabs are gated. ────────
// Landing pages is also shown READ-ONLY to anyone who can upload ads — E023
// sends uploaders there, and a hidden registry was a dead end.
export const LIBRARY_TABS = [
  { key: "creatives", label: "Creatives", perm: null },
  { key: "products", label: "Products", perm: "catalog.products" },
  {
    key: "landing-pages",
    label: "Landing pages",
    perm: ["catalog.landing_pages", "upload.import"],
  },
  { key: "angles", label: "Angles", perm: "catalog.angles" },
] as const satisfies readonly GatedTab[];

// ── Configuration (/admin/catalog) — nothing but its tabs: with none, 404. ──
export const CONFIGURATION_TABS = [
  { key: "rating", label: "Rate rules", perm: "config.rating" },
  { key: "status", label: "Status", perm: "config.brands" },
  { key: "brands", label: "Brands", perm: "config.brands" },
  { key: "exclusions", label: "Exclusions", perm: "record.exclude" },
  { key: "notifications", label: "Notifications", perm: "notify.manage" },
] as const satisfies readonly GatedTab[];

// ── Upload ads (/uploads) — the history is readable by every member; what
// the page OFFERS beyond it is gated: the mapping tab and three actions. ─────
export const UPLOAD_ADS_TABS = [
  { key: "history", label: "History", perm: null },
  { key: "mapping", label: "CSV mapping", perm: "config.mappings" },
] as const satisfies readonly GatedTab[];
export const UPLOAD_ADS_ACTIONS = [
  "upload.import",
  "upload.rollback",
  "upload.cleanup",
] as const satisfies readonly Permission[];

// ── Upload orders (/store/uploads) — the same shape. ────────────────────────
export const UPLOAD_ORDERS_TABS = [
  { key: "history", label: "History", perm: null },
  { key: "fields", label: "Order fields", perm: "config.store" },
] as const satisfies readonly GatedTab[];
export const UPLOAD_ORDERS_ACTIONS = [
  "store.upload",
  "upload.rollback",
  "store.cleanup",
] as const satisfies readonly Permission[];

// ── Whole-page gates (`requirePermission` at the top of the page). ──────────
export const TEAM_GATE = "users.manage" as const satisfies Permission;
export const AUDIT_GATE = "audit.view" as const satisfies Permission;

/**
 * The sidebar gate of every gated nav route, DERIVED from the page's own
 * gates: a route shows for anyone who can open — or act on — at least one
 * part of it, and for nobody who would land on a 404. The upload pages count
 * only their GATED parts: their read-only history alone doesn't put them in
 * a viewer's sidebar (unchanged; see the W3 report).
 */
export const NAV_ROUTE_GATES = {
  "/uploads": gatePermissions([
    ...UPLOAD_ADS_ACTIONS,
    ...UPLOAD_ADS_TABS.map((t) => t.perm),
  ]),
  "/store/uploads": gatePermissions([
    ...UPLOAD_ORDERS_ACTIONS,
    ...UPLOAD_ORDERS_TABS.map((t) => t.perm),
  ]),
  "/admin/catalog": gatePermissions(CONFIGURATION_TABS.map((t) => t.perm)),
  "/admin/users": [TEAM_GATE],
  "/admin/audit": [AUDIT_GATE],
} as const satisfies Record<string, readonly Permission[]>;
