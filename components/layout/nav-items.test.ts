import { describe, expect, it } from "vitest";
import { NAV_ITEMS, visibleNavItems } from "@/components/layout/nav-items";
import { ALL_PERMISSIONS, EDITOR_PRESET } from "@/lib/permissions";

const labels = (perms: Iterable<string>) =>
  visibleNavItems(perms).map((i) => i.label);

describe("visibleNavItems", () => {
  it("a viewer (no permissions) sees only the read-only pages", () => {
    const seen = labels([]);
    // The always-visible dashboards have no `perms` gate.
    expect(seen).toContain("Dashboard");
    expect(seen).toContain("Creatives");
    expect(seen).toContain("Campaigns");
    // Everything gated is hidden.
    expect(seen).not.toContain("Uploads");
    expect(seen).not.toContain("Configuration");
    expect(seen).not.toContain("Access");
    expect(seen).not.toContain("Team");
    expect(seen).not.toContain("Audit log");
  });

  it("the editor preset unlocks Uploads but no admin items", () => {
    const seen = labels(EDITOR_PRESET);
    expect(seen).toContain("Uploads"); // has upload.import
    expect(seen).not.toContain("Access"); // users.manage not in preset
    expect(seen).not.toContain("Configuration");
    expect(seen).not.toContain("Audit log");
  });

  it("a user with every permission (admin) sees all items", () => {
    expect(labels(ALL_PERMISSIONS)).toEqual(NAV_ITEMS.map((i) => i.label));
  });

  it("a single grant reveals exactly the items it unlocks", () => {
    expect(labels(["users.manage"])).toContain("Access");
    expect(labels(["users.manage"])).toContain("Team");
    expect(labels(["users.manage"])).not.toContain("Audit log");
    expect(labels(["audit.view"])).toContain("Audit log");
    expect(labels(["audit.view"])).not.toContain("Access");
  });

  it("every gated item's perms are real catalog keys (derive integrity)", () => {
    const all = new Set<string>(ALL_PERMISSIONS);
    for (const item of NAV_ITEMS) {
      for (const p of item.perms ?? []) expect(all.has(p)).toBe(true);
    }
  });
});
