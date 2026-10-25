import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { platformsPillValue } from "@/components/filters/platforms-pill";
import { STRIP_FILTER_KEYS, STRIP_TIER2_KEYS } from "@/validators/filters";
import { ALL_PLATFORMS, PLATFORMS_WITH_CREATIVES } from "@/lib/palette";

const ROOT = process.cwd();
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(entry)) out.push(path.relative(ROOT, p));
  }
  return out;
}

describe("ONE Platforms pill (D21)", () => {
  it("an empty selection reads All and is not tinted — a filter that is off", () => {
    expect(platformsPillValue([], ALL_PLATFORMS)).toEqual({ value: "All", active: false });
  });
  it("every option selected also reads All", () => {
    expect(platformsPillValue([...PLATFORMS_WITH_CREATIVES], PLATFORMS_WITH_CREATIVES)).toEqual({
      value: "All",
      active: false,
    });
  });
  it("one platform reads its label; several read a count", () => {
    expect(platformsPillValue(["instagram"], ALL_PLATFORMS)).toEqual({
      value: "Instagram",
      active: true,
    });
    expect(platformsPillValue(["instagram", "tiktok"], ALL_PLATFORMS).value).toBe("2 selected");
  });
  it("Ads (column groups): an empty selection is honestly None", () => {
    expect(platformsPillValue([], PLATFORMS_WITH_CREATIVES, "none")).toEqual({
      value: "None",
      active: true,
    });
  });
  it("no bar hand-rolls a Platforms pill any more", () => {
    const offenders = ["components", "app"]
      .flatMap((d) => walk(path.join(ROOT, d)))
      .filter((f) => f !== "components/filters/platforms-pill.tsx")
      .filter((f) => /label="Platforms"/.test(readFileSync(path.join(ROOT, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("FilterStrip's Clear clears tier-2 only (D19)", () => {
  it("tier 2 is products, types and angles — never the date, Excluded or platforms", () => {
    expect([...STRIP_TIER2_KEYS]).toEqual(["productIds", "types", "angles"]);
    for (const k of ["from", "to", "includeExcluded", "platforms"])
      expect(STRIP_TIER2_KEYS as readonly string[]).not.toContain(k);
    expect(STRIP_FILTER_KEYS).toContain("platforms");
  });
  it("the strip's clearAll deletes exactly STRIP_TIER2_KEYS", () => {
    const src = readFileSync(path.join(ROOT, "components/filters/filter-strip.tsx"), "utf8");
    const body = src.slice(src.indexOf("const clearAll"), src.indexOf("};", src.indexOf("const clearAll")));
    expect(body).toContain("STRIP_TIER2_KEYS");
    expect(body).not.toMatch(/delete\("(from|to|includeExcluded|platforms)"\)/);
  });
  it("the strip writes through useFilterParams (remembered filters, D20)", () => {
    const src = readFileSync(path.join(ROOT, "components/filters/filter-strip.tsx"), "utf8");
    expect(src).toContain("useFilterParams(resolvedFilters)");
    expect(src).toContain("setPersistedKeys(");
    expect(src).not.toContain("router.replace");
  });
  it("every FilterStrip page resolves its remembered filters on the server", () => {
    for (const page of [
      "app/(dashboard)/page.tsx",
      "app/(dashboard)/funnel/page.tsx",
      "app/(dashboard)/trends/over-time/page.tsx",
      "app/(dashboard)/trends/by-angle/page.tsx",
      "app/(dashboard)/trends/by-type/page.tsx",
      "app/(dashboard)/trends/launches/page.tsx",
      "app/(dashboard)/trends/video/page.tsx",
      "app/(dashboard)/trends/landing-pages/page.tsx",
    ]) {
      const src = readFileSync(path.join(ROOT, page), "utf8");
      expect(src, page).toContain("resolveStripFilters(");
      expect(src, page).toContain("resolvedFilters={resolved}");
    }
  });
});
