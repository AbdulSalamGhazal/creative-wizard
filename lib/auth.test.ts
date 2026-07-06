import { describe, expect, it } from "vitest";
import { can, grantedPermissions } from "@/lib/auth";
import { EDITOR_PRESET } from "@/lib/permissions";

/** Minimal user shape `can()` reads. */
const user = (role: "admin" | "editor" | "viewer", permissions: string[] | null) => ({
  role,
  permissions,
});

describe("can()", () => {
  it("admin bypasses every check (even with an empty explicit set)", () => {
    expect(can(user("admin", null), "creative.create")).toBe(true);
    expect(can(user("admin", []), "users.manage")).toBe(true);
    expect(can(user("admin", ["nothing"]), "upload.rollback")).toBe(true);
  });

  it("editor with NULL falls back to the editor preset", () => {
    const u = user("editor", null);
    expect(can(u, "creative.delete")).toBe(true); // in preset
    expect(can(u, "upload.rollback")).toBe(false); // admin-only
    expect(can(u, "users.manage")).toBe(false);
  });

  it("viewer with NULL is denied everything", () => {
    const u = user("viewer", null);
    expect(can(u, "creative.create")).toBe(false);
    expect(can(u, "record.exclude")).toBe(false);
  });

  it("an explicit set grants exactly what it lists", () => {
    const u = user("viewer", ["upload.import"]);
    expect(can(u, "upload.import")).toBe(true);
    expect(can(u, "upload.upsert")).toBe(false);
    expect(can(u, "creative.create")).toBe(false);
  });

  it("an explicit set overrides the role preset", () => {
    // An editor pinned to just one permission loses the rest of the preset.
    const u = user("editor", ["campaign.edit"]);
    expect(can(u, "campaign.edit")).toBe(true);
    expect(can(u, "creative.create")).toBe(false);
  });

  it("grantedPermissions lists the effective set", () => {
    expect(grantedPermissions(user("editor", null)).sort()).toEqual(
      [...EDITOR_PRESET].sort(),
    );
    expect(grantedPermissions(user("viewer", null))).toEqual([]);
    expect(grantedPermissions(user("editor", ["upload.import"]))).toEqual([
      "upload.import",
    ]);
  });
});
