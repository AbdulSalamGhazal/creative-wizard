import { describe, expect, it } from "vitest";
import { effectiveView } from "@/lib/effective-view";
import { normalizeQuery } from "@/lib/comments";

const params = (q: string) => Object.fromEntries(new URLSearchParams(q));

/**
 * comments-notifications.md (a): a comment's deep link reproduces what its
 * author was looking at. Pages resolve range, filters and Excluded SERVER-side,
 * so on a remembered-filter page the address bar is bare and the comment
 * stored "" — the reader then saw THEIR OWN filters (2026-11-01).
 */
describe("effectiveView — the view as the user SEES it", () => {
  it("a bare URL becomes the resolved filters, the absolute range, Excluded, and fx", () => {
    const v = effectiveView("", {
      filters: { platforms: "facebook,tiktok", productIds: undefined },
      range: { from: "2026-10-17", to: "2026-10-30" },
      includeExcluded: false,
    });
    expect(params(v)).toEqual({
      platforms: "facebook,tiktok",
      fx: "1", // the reader's own preferences must not overlay it
      from: "2026-10-17",
      to: "2026-10-30",
      includeExcluded: "0",
    });
  });

  it("the URL wins over the resolved values, and its own params are kept verbatim", () => {
    const v = effectiveView("platforms=instagram&sort=spend-desc&from=2026-01-01&to=2026-01-31&includeExcluded=1", {
      filters: { platforms: "facebook" },
      range: { from: "2026-10-17", to: "2026-10-30" },
      includeExcluded: false,
    });
    expect(v.startsWith("platforms=instagram&sort=spend-desc&from=2026-01-01&to=2026-01-31&includeExcluded=1")).toBe(true);
    expect(params(v)).toMatchObject({ platforms: "instagram", from: "2026-01-01", includeExcluded: "1", fx: "1" });
  });

  it("an fx URL already states its filters in full — no resolved filter is added", () => {
    const v = effectiveView("fx=1&types=video", { filters: { platforms: "facebook" } });
    expect(params(v)).toEqual({ fx: "1", types: "video" });
  });

  it("a saved view owns its filter state — kept as sv, never overlaid or marked fx", () => {
    const v = effectiveView("sv=abc", {
      filters: { platforms: "facebook" },
      range: { from: "2026-10-17", to: "2026-10-30" },
    });
    expect(params(v)).toEqual({ sv: "abc", from: "2026-10-17", to: "2026-10-30" });
  });

  it("a half range in the URL is no range — the resolved one is stated, once", () => {
    for (const half of ["from=2026-01-01", "to=2026-01-31", "tab=x&to=2026-01-31"]) {
      const v = effectiveView(half, { range: { from: "2026-10-17", to: "2026-10-30" } });
      expect(new URLSearchParams(v).getAll("from")).toEqual(["2026-10-17"]);
      expect(new URLSearchParams(v).getAll("to")).toEqual(["2026-10-30"]);
    }
  });

  it("a page that resolves nothing keeps its URL as it is", () => {
    expect(effectiveView("tab=products", {})).toBe("tab=products");
    expect(effectiveView("", {})).toBe("");
  });

  it("a leading ? is accepted", () => {
    expect(effectiveView("?tab=x", {})).toBe("tab=x");
  });

  it("two readers on the same effective view compare equal, bare URL or not", () => {
    const resolved = {
      filters: { platforms: "facebook,tiktok" },
      range: { from: "2026-10-17", to: "2026-10-30" },
      includeExcluded: false,
    };
    const written = effectiveView("", resolved);
    const materialized = effectiveView(
      "platforms=facebook%2Ctiktok&fx=1&from=2026-10-17&to=2026-10-30&includeExcluded=0",
      resolved,
    );
    expect(normalizeQuery(written)).toBe(normalizeQuery(materialized));
  });
});
