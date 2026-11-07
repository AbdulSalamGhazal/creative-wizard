import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cleanViewQuery, savedViewHref, SAVED_VIEW_PATH } from "@/lib/saved-view-href";
import { qualifiedNavLabel } from "@/components/layout/nav-items";

describe("savedViewHref (the palette's saved views, R-027)", () => {
  it("applies a view's query with the sv marker, dropping transient params", () => {
    expect(savedViewHref("/summary", "platforms=meta&view=none&sv=old", "v1")).toBe(
      "/summary?platforms=meta&sv=v1",
    );
  });
  it("routes an EMPTY view through ?view=none so the default can't bounce it", () => {
    expect(savedViewHref("/library", "", "v2")).toBe("/library?view=none&sv=v2");
    expect(cleanViewQuery("view=none&fx=1")).toBe("");
  });
  it("knows a route for every page the Views control is mounted on", () => {
    for (const [file, page] of [
      ["components/summary/summary-filter-bar.tsx", "summary"],
      ["components/creative/library-filter-bar.tsx", "creatives"],
      ["components/portfolio/portfolio-filter-bar.tsx", "campaigns"],
    ] as const) {
      const src = readFileSync(file, "utf8");
      expect(src).toContain("<ViewsControl");
      expect(SAVED_VIEW_PATH[page]).toBeTruthy();
    }
  });
  it("mirrors the Views control's own apply (same marker, same escape)", () => {
    const src = readFileSync("components/summary/views-control.tsx", "utf8");
    expect(src).toContain("?view=none&${VIEW_MARKER_PARAM}=${viewId}");
    expect(src).toContain("?${clean}&${VIEW_MARKER_PARAM}=${viewId}");
  });
});

describe("qualifiedNavLabel (palette + collapsed rail, R-088)", () => {
  it("qualifies outside Ads, and not where the item is the section", () => {
    expect(qualifiedNavLabel({ key: "ads", label: "Ads" }, "Library")).toBe("Library");
    expect(qualifiedNavLabel({ key: "budget", label: "Budget" }, "Overview")).toBe(
      "Budget · Overview",
    );
    expect(qualifiedNavLabel({ key: "budget", label: "Budget" }, "Budget")).toBe("Budget");
  });
});
