import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  ANY_BRAND,
  BRANDED_SEGMENTS,
  classifyPath,
  isBrandSlug,
  isReservedSlug,
  splitBrandPath,
  stripBrand,
  switchTarget,
  withBrand,
} from "@/lib/brand-path";

const DASH = path.join(process.cwd(), "app", "[brand]", "(dashboard)");

describe("the branded route list", () => {
  it("is exactly the dashboard's top-level sections, plus /go", () => {
    const dirs = readdirSync(DASH).filter((d) => statSync(path.join(DASH, d)).isDirectory());
    expect([...BRANDED_SEGMENTS].sort()).toEqual([...dirs, "go"].sort());
  });
});

describe("classifying a path", () => {
  it("a section path is legacy, an API/auth path or file is other, anything else is a brand", () => {
    expect(classifyPath("/")).toBe("legacy");
    expect(classifyPath("/library/x")).toBe("legacy");
    expect(classifyPath("/go/comment/1")).toBe("legacy");
    expect(classifyPath("/api/palette")).toBe("other");
    expect(classifyPath("/signin")).toBe("other");
    expect(classifyPath("/icon.png")).toBe("other");
    expect(classifyPath("/urjwan")).toBe("branded");
    expect(classifyPath("/mesbah/budget/plan")).toBe("branded");
  });

  it("splits and strips the brand", () => {
    expect(splitBrandPath("/urjwan/library/A%20B")).toEqual({ slug: "urjwan", rest: "/library/A%20B" });
    expect(splitBrandPath("/urjwan")).toEqual({ slug: "urjwan", rest: "/" });
    expect(splitBrandPath("/library")).toEqual({ slug: null, rest: "/library" });
    expect(stripBrand("/mesbah/admin/catalog")).toBe("/admin/catalog");
  });
});

describe("putting an href under a brand", () => {
  it("prefixes app paths, keeping query and hash", () => {
    expect(withBrand("urjwan", "/library")).toBe("/urjwan/library");
    expect(withBrand("urjwan", "/")).toBe("/urjwan");
    expect(withBrand("urjwan", "/?x=1")).toBe("/urjwan?x=1");
    expect(withBrand("urjwan", "/budget/plan?month=2026-11#top")).toBe("/urjwan/budget/plan?month=2026-11#top");
  });

  it("leaves everything else alone", () => {
    expect(withBrand("urjwan", "/mesbah/library")).toBe("/mesbah/library"); // another brand's link
    expect(withBrand("urjwan", "/api/palette")).toBe("/api/palette");
    expect(withBrand("urjwan", "/signin?next=/x")).toBe("/signin?next=/x");
    expect(withBrand("urjwan", "https://example.com/library")).toBe("https://example.com/library");
    expect(withBrand("urjwan", "//evil.example/library")).toBe("//evil.example/library");
    expect(withBrand("urjwan", "?tab=x")).toBe("?tab=x");
    expect(withBrand(null, "/library")).toBe("/library");
  });
});

describe("brand slugs", () => {
  it("can never be a page or root name", () => {
    for (const s of ["library", "store", "budget", "go", "api", "signin", "oauth", ANY_BRAND]) {
      expect(isReservedSlug(s), s).toBe(true);
    }
    expect(isReservedSlug("urjwan")).toBe(false);
    expect(isReservedSlug("mesbah")).toBe(false);
    expect(isBrandSlug("urjwan")).toBe(true);
    expect(isBrandSlug("store")).toBe(false);
    expect(isBrandSlug("Bad Slug")).toBe(false);
    expect(isBrandSlug(undefined)).toBe(false);
  });
});

describe("where switching brand lands", () => {
  it("a list page keeps its path and filters, minus another brand's comment and version", () => {
    expect(switchTarget("mesbah", "/library", "?type=video&comment=c1")).toEqual({
      href: "/mesbah/library?type=video",
      moved: null,
    });
    expect(switchTarget("mesbah", "/price-structure/plan", "?v=abc")).toEqual({
      href: "/mesbah/price-structure/plan",
      moved: null,
    });
    expect(switchTarget("mesbah", "/", "")).toEqual({ href: "/mesbah", moved: null });
  });

  it("an item's own page goes to its section's list, and says so", () => {
    expect(switchTarget("mesbah", "/library/URJ_VID_001", "?tab=perf")).toEqual({
      href: "/mesbah/library",
      moved: { what: "creative", section: "Library" },
    });
    expect(switchTarget("mesbah", "/campaigns/Spring", "")).toMatchObject({
      href: "/mesbah/campaigns",
      moved: { what: "campaign" },
    });
    expect(switchTarget("mesbah", "/price-structure/products/p1/o1", "?v=x").href).toBe(
      "/mesbah/price-structure/products",
    );
  });

  it("the create pages are not items", () => {
    expect(switchTarget("mesbah", "/library/new", "").moved).toBeNull();
    expect(switchTarget("mesbah", "/library/bulk", "").moved).toBeNull();
    expect(switchTarget("mesbah", "/campaigns/new", "").moved).toBeNull();
  });
});
