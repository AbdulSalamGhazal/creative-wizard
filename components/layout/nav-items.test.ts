import { describe, expect, it } from "vitest";
import {
  NAV_ITEMS,
  NAV_SECTIONS,
  navSections,
  sectionForPath,
  visibleNavItems,
} from "@/components/layout/nav-items";
import { ALL_PERMISSIONS, EDITOR_PRESET } from "@/lib/permissions";

const labels = (perms: Iterable<string>) =>
  visibleNavItems(perms).map((i) => i.label);

describe("visibleNavItems", () => {
  it("a viewer (no permissions) sees only the read-only pages", () => {
    const seen = labels([]);
    // The always-visible dashboards have no `perms` gate.
    expect(seen).toContain("Dashboard");
    expect(seen).toContain("Library");
    expect(seen).toContain("Campaigns");
    // Everything gated is hidden.
    expect(seen).not.toContain("Upload ads");
    expect(seen).not.toContain("Configuration");
    expect(seen).not.toContain("Team");
    expect(seen).not.toContain("Audit log");
  });

  it("the editor preset unlocks Upload ads and Configuration (Exclusions), not Team or Audit", () => {
    const seen = labels(EDITOR_PRESET);
    expect(seen).toContain("Upload ads"); // has upload.import
    // D18: editors hold record.exclude, so Configuration → Exclusions is
    // theirs — the page "Excluded by rule" sends them to.
    expect(seen).toContain("Configuration");
    expect(seen).not.toContain("Team"); // users.manage not in preset
    expect(seen).not.toContain("Audit log");
  });

  it("a user with every permission (admin) sees all items", () => {
    expect(labels(ALL_PERMISSIONS)).toEqual(NAV_ITEMS.map((i) => i.label));
  });

  it("a single grant reveals exactly the items it unlocks", () => {
    expect(labels(["users.manage"])).toContain("Team");
    expect(labels(["users.manage"])).not.toContain("Audit log");
    expect(labels(["audit.view"])).toContain("Audit log");
    expect(labels(["audit.view"])).not.toContain("Team");
  });

  it("every gated item's perms are real catalog keys (derive integrity)", () => {
    const all = new Set<string>(ALL_PERMISSIONS);
    for (const item of NAV_ITEMS) {
      for (const p of item.perms ?? []) expect(all.has(p)).toBe(true);
    }
  });
});

describe("the nav's order and the accordion's default section (2026-11-08)", () => {
  it("sections read Advertisements · Budget · Store · Pricing · Admin", () => {
    expect(NAV_SECTIONS.map((s) => s.label)).toEqual([
      "Advertisements",
      "Budget",
      "Store",
      "Pricing",
      "Admin",
    ]);
  });

  it("Advertisements reads Dashboard · Library · Ads · Campaigns · Canvas · Funnel · Analyzers · Upload ads", () => {
    expect(NAV_ITEMS.filter((i) => i.group === "ads").map((i) => i.label)).toEqual([
      "Dashboard",
      "Library",
      "Ads",
      "Campaigns",
      "Canvas",
      "Funnel",
      "Analyzers",
      "Upload ads",
    ]);
  });

  it("Analyzers holds Compare first, then the trend pages, at their old URLs", () => {
    const hub = NAV_ITEMS.find((i) => i.label === "Analyzers")!;
    expect(hub.children?.map((c) => c.label)).toEqual([
      "Compare",
      "Changes",
      "Angles",
      "Types",
      "Launches",
      "Video",
      "LPs",
    ]);
    expect(hub.href).toBe("/compare");
    for (const c of hub.children!.slice(1)) expect(c.href.startsWith("/trends/")).toBe(true);
  });

  const all = navSections(ALL_PERMISSIONS);
  it.each([
    ["/", "ads"],
    ["/library/Hook%2001", "ads"],
    ["/compare", "ads"],
    ["/trends/by-angle", "ads"],
    ["/budget", "budget"],
    ["/budget/pacing", "budget"],
    ["/store/uploads/new", "store"],
    ["/price-structure/plan", "pricing"],
    ["/admin/users", "admin"],
  ])("%s opens %s", (path, key) => {
    expect(sectionForPath(all, path)).toBe(key);
  });

  it("a page outside the nav has no section (the caller opens the first)", () => {
    expect(sectionForPath(all, "/notifications")).toBeNull();
    expect(sectionForPath(all, "/account")).toBeNull();
  });

  it("a section the viewer can't see is never the answer", () => {
    // A viewer has no Admin section; /admin/users finds nothing to open.
    expect(sectionForPath(navSections([]), "/admin/users")).toBeNull();
  });
});
