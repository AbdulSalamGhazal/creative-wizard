import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  EDITOR_PRESET,
  PERMISSION_GROUPS,
  VIEWER_PRESET,
  isPermission,
  presetPermissions,
  resolvePermissions,
} from "@/lib/permissions";

describe("permission catalog", () => {
  it("ALL_PERMISSIONS is the flattened catalog with no duplicates", () => {
    const fromGroups = PERMISSION_GROUPS.flatMap((g) => g.perms.map((p) => p.key));
    expect([...ALL_PERMISSIONS]).toEqual(fromGroups);
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it("every permission has a non-empty label", () => {
    for (const g of PERMISSION_GROUPS) {
      expect(g.label.length).toBeGreaterThan(0);
      for (const p of g.perms) expect(p.label.length).toBeGreaterThan(0);
    }
  });

  it("isPermission accepts catalog keys and rejects others", () => {
    for (const p of ALL_PERMISSIONS) expect(isPermission(p)).toBe(true);
    expect(isPermission("not.a.perm")).toBe(false);
    expect(isPermission("")).toBe(false);
  });
});

describe("role presets", () => {
  it("every editor-preset perm exists in the catalog (derive integrity)", () => {
    for (const p of EDITOR_PRESET) expect(isPermission(p)).toBe(true);
  });

  it("editor preset matches today's requireEditor behavior exactly", () => {
    // Has: all creative + campaign mutations, import/upsert/cleanup, exclusion.
    expect([...EDITOR_PRESET].sort()).toEqual(
      [
        "creative.create",
        "creative.edit",
        "creative.delete",
        "campaign.create",
        "campaign.edit",
        "campaign.delete",
        "upload.import",
        "upload.upsert",
        "upload.cleanup",
        "record.exclude",
      ].sort(),
    );
    // Lacks: rollback, catalog/config, user management, audit (admin-only today).
    for (const denied of [
      "upload.rollback",
      "catalog.products",
      "catalog.tags",
      "config.rating",
      "config.mappings",
      "config.brands",
      "users.manage",
      "audit.view",
    ]) {
      expect(EDITOR_PRESET).not.toContain(denied);
    }
  });

  it("viewer preset is empty (read-only)", () => {
    expect(VIEWER_PRESET).toEqual([]);
  });

  it("presetPermissions: admin=all, editor=preset, viewer=none", () => {
    expect(presetPermissions("admin")).toEqual(ALL_PERMISSIONS);
    expect(presetPermissions("editor")).toEqual(EDITOR_PRESET);
    expect(presetPermissions("viewer")).toEqual(VIEWER_PRESET);
  });
});

describe("resolvePermissions", () => {
  it("admin resolves to everything regardless of explicit set", () => {
    expect(resolvePermissions("admin", null).size).toBe(ALL_PERMISSIONS.length);
    expect(resolvePermissions("admin", []).size).toBe(ALL_PERMISSIONS.length);
  });

  it("NULL explicit set falls back to the role preset", () => {
    const editor = resolvePermissions("editor", null);
    expect(editor.has("creative.create")).toBe(true);
    expect(editor.has("users.manage")).toBe(false);
    expect(resolvePermissions("viewer", null).size).toBe(0);
  });

  it("a non-null explicit set overrides the role preset", () => {
    const custom = resolvePermissions("editor", ["upload.import"]);
    expect(custom.has("upload.import")).toBe(true);
    expect(custom.has("creative.create")).toBe(false); // editor preset ignored
  });

  it("filters out stale/unknown keys from an explicit set", () => {
    const custom = resolvePermissions("viewer", ["upload.import", "bogus.key"]);
    expect(custom.has("upload.import")).toBe(true);
    expect(custom.size).toBe(1);
  });
});
