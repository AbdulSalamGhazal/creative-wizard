import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, EDITOR_PRESET } from "@/lib/permissions";
import { classifyChecked, effectivePermissions, presetOf } from "@/lib/team-presets";

describe("presetOf — how saved access reads as a badge", () => {
  it("admin is a tier, whatever the array says", () => {
    expect(presetOf("admin", null)).toBe("admin");
    expect(presetOf("admin", [])).toBe("admin");
  });
  it("NULL permissions are the tier's preset", () => {
    expect(presetOf("editor", null)).toBe("editor");
    expect(presetOf("viewer", null)).toBe("viewer");
  });
  it("an explicit set is classified by what it holds, not by the tier", () => {
    expect(presetOf("viewer", [...EDITOR_PRESET])).toBe("editor");
    expect(presetOf("editor", [])).toBe("viewer");
    expect(presetOf("editor", ["creative.edit"])).toBe("custom");
    // Stale keys don't make a set "custom" on their own.
    expect(presetOf("viewer", ["not.a.permission"])).toBe("viewer");
  });
  it("classifyChecked agrees with presetOf on a checked set", () => {
    expect(classifyChecked(new Set(EDITOR_PRESET))).toBe("editor");
    expect(classifyChecked(new Set())).toBe("viewer");
    expect(classifyChecked(new Set(["audit.view"]))).toBe("custom");
  });
});

describe("effectivePermissions mirrors the server's resolvePermissions", () => {
  it("admin → everything; null → preset; array → filtered", () => {
    expect(effectivePermissions("admin", null)).toEqual(new Set(ALL_PERMISSIONS));
    expect(effectivePermissions("editor", null)).toEqual(new Set(EDITOR_PRESET));
    expect(effectivePermissions("viewer", ["audit.view", "bogus"])).toEqual(new Set(["audit.view"]));
  });
});
