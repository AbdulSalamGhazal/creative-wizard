import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NAV_ITEMS, visibleNavItems } from "@/components/layout/nav-items";
import {
  ALL_PERMISSIONS,
  EDITOR_PRESET,
  VIEWER_PRESET,
  type Permission,
} from "@/lib/permissions";
import {
  AUDIT_GATE,
  CONFIGURATION_TABS,
  NAV_ROUTE_GATES,
  TEAM_GATE,
  UPLOAD_ADS_ACTIONS,
  UPLOAD_ADS_TABS,
  UPLOAD_ORDERS_ACTIONS,
  UPLOAD_ORDERS_TABS,
  passes,
} from "@/lib/page-gates";

/**
 * D18 (2026-10): the sidebar is DERIVED from the page and tab gates, and this
 * compares the two. Before, the nav's lists were hand-copied: editors (who
 * all hold `record.exclude`) had no route to Configuration → Exclusions, and
 * a `catalog.products`-only user saw "Configuration" and landed on a 404.
 */

const ROOT = process.cwd();
const src = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const navFor = (perms: readonly string[]) =>
  new Set(visibleNavItems(perms).map((i) => i.href));

/** What a holder of `perms` can open or act on, per gated route — read from
 *  the gates the PAGES themselves filter with. */
function pageAccess(perms: readonly string[]): Record<string, boolean> {
  const set = new Set(perms);
  const has = (p: Permission) => set.has(p);
  const anyGated = (tabs: readonly { perm: Parameters<typeof passes>[0] }[]) =>
    tabs.some((t) => t.perm !== null && passes(t.perm, has));
  return {
    "/admin/catalog": CONFIGURATION_TABS.some((t) => passes(t.perm, has)),
    "/uploads": UPLOAD_ADS_ACTIONS.some(has) || anyGated(UPLOAD_ADS_TABS),
    "/store/uploads": UPLOAD_ORDERS_ACTIONS.some(has) || anyGated(UPLOAD_ORDERS_TABS),
    "/admin/users": has(TEAM_GATE),
    "/admin/audit": has(AUDIT_GATE),
  };
}

describe("every gated nav item reads its page's gates", () => {
  it("a gated item's perms ARE its route's derived gate", () => {
    for (const item of NAV_ITEMS.filter((i) => i.perms)) {
      const gate = NAV_ROUTE_GATES[item.href as keyof typeof NAV_ROUTE_GATES];
      expect(gate, `${item.href} has perms but no NAV_ROUTE_GATES entry`).toBeDefined();
      expect([...item.perms!].sort()).toEqual([...gate].sort());
    }
  });

  it("the nav source never hand-lists a permission", () => {
    expect(src("components/layout/nav-items.ts")).not.toMatch(/perms:\s*\[\s*"/);
  });

  it("each page filters with the same table the nav derives from", () => {
    expect(src("app/(dashboard)/admin/catalog/page.tsx")).toContain("CONFIGURATION_TABS");
    expect(src("app/(dashboard)/library/page.tsx")).toContain("LIBRARY_TABS");
    expect(src("app/(dashboard)/uploads/page.tsx")).toContain("UPLOAD_ADS_TABS");
    expect(src("app/(dashboard)/store/uploads/page.tsx")).toContain("UPLOAD_ORDERS_TABS");
    expect(src("app/(dashboard)/admin/users/page.tsx")).toContain("requirePermission(TEAM_GATE)");
    expect(src("app/(dashboard)/admin/audit/page.tsx")).toContain("requirePermission(AUDIT_GATE)");
  });

  it("every permission an upload page checks is in its nav gate", () => {
    const checked = (rel: string) =>
      [...src(rel).matchAll(/\bcan\([^,]+,\s*"([a-z_.]+)"\)/g)].map((m) => m[1]!);
    for (const p of checked("app/(dashboard)/uploads/page.tsx"))
      expect(NAV_ROUTE_GATES["/uploads"] as readonly string[]).toContain(p);
    for (const p of checked("app/(dashboard)/store/uploads/page.tsx"))
      expect(NAV_ROUTE_GATES["/store/uploads"] as readonly string[]).toContain(p);
  });
});

describe("the sidebar shows a gated page exactly to whoever can use it", () => {
  const people: Array<[string, readonly string[]]> = [
    ["viewer", VIEWER_PRESET],
    ["editor", EDITOR_PRESET],
    ["admin", ALL_PERMISSIONS],
    ...ALL_PERMISSIONS.map((p): [string, readonly string[]] => [`only ${p}`, [p]]),
  ];
  for (const [who, perms] of people) {
    it(who, () => {
      const nav = navFor(perms);
      for (const [route, canUse] of Object.entries(pageAccess(perms))) {
        expect(nav.has(route), `${who}: ${route}`).toBe(canUse);
      }
    });
  }
});

describe("the five people the brief names", () => {
  it("only record.exclude: Configuration (its Exclusions tab), nothing else gated", () => {
    const nav = navFor(["record.exclude"]);
    expect(nav.has("/admin/catalog")).toBe(true);
    expect(nav.has("/uploads")).toBe(false);
    expect(nav.has("/admin/users")).toBe(false);
  });
  it("only catalog.products: NO Configuration (its tab lives on the Library now)", () => {
    const nav = navFor(["catalog.products"]);
    expect(nav.has("/admin/catalog")).toBe(false);
    expect(nav.has("/library")).toBe(true);
  });
  it("editor: Configuration (Exclusions) and Upload ads", () => {
    const nav = navFor(EDITOR_PRESET);
    expect(nav.has("/admin/catalog")).toBe(true);
    expect(nav.has("/uploads")).toBe(true);
  });
  it("viewer: no gated item", () => {
    const nav = navFor(VIEWER_PRESET);
    for (const route of Object.keys(NAV_ROUTE_GATES)) expect(nav.has(route)).toBe(false);
  });
  it("admin: everything", () => {
    expect(navFor(ALL_PERMISSIONS).size).toBe(NAV_ITEMS.length);
  });
});
