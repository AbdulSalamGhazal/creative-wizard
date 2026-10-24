import { describe, expect, it } from "vitest";
import type { PlatformMetricBlock, SummaryRow } from "@/db/queries/summary";
import { DEFAULT_RATING_CONFIG } from "@/lib/rating";
import { resolveSummarySort, sortSummaryRows } from "@/lib/summary-sort";
import {
  adsColumnsFromParams,
  writeAdsColumnParams,
} from "@/components/summary/summary-columns";

/**
 * The Ads order (D12): the server lists with it and the table re-sorts with
 * it on a click, so each rule the old SQL ORDER BY + JS re-sorts encoded is
 * pinned here.
 */
const block = (over: Partial<PlatformMetricBlock> = {}): PlatformMetricBlock => ({
  spend: 0, impressions: 0, clicks: 0, conversions: null, conversionValue: null,
  ctr: null, cpm: null, cpc: null, cpa: null, roas: null, hookRate: null,
  holdRate: null, completeRate: null, landingPageViews: 0, voc: null, cvr: null,
  ...over,
});
const row = (name: string, over: Partial<SummaryRow> = {}): SummaryRow => ({
  creativeId: name, name, productId: "p", productName: "P", type: "video",
  generalStatus: "active", perPlatformStatus: {}, creatorName: null, creatorEmail: null,
  priority: null, stages: [], launchDate: null, angles: [],
  perPlatform: {}, total: block(), ...over,
});
const names = (rows: SummaryRow[]) => rows.map((r) => r.name);
const sort = (rows: SummaryRow[], key: string, dir: "asc" | "desc") =>
  names(sortSummaryRows(rows, { key, dir }, DEFAULT_RATING_CONFIG));

describe("resolveSummarySort — the URL read the way the server reads it", () => {
  it("falls back to total spend desc for anything it can't honour", () => {
    const d = { key: "total.spend", dir: "desc" };
    expect(resolveSummarySort(null, null, ["instagram"])).toEqual(d);
    expect(resolveSummarySort("bogus", "asc", ["instagram"])).toEqual(d);
    expect(resolveSummarySort("tiktok.cpa", "asc", ["instagram"])).toEqual(d); // not selected
    expect(resolveSummarySort("total.status", "asc", ["instagram"])).toEqual(d);
    expect(resolveSummarySort("instagram.cpa", "asc", ["instagram"])).toEqual({ key: "instagram.cpa", dir: "asc" });
    expect(resolveSummarySort("name", "weird", [])).toEqual({ key: "name", dir: "desc" });
  });
});

describe("sortSummaryRows — every rule the query used to encode", () => {
  it("a metric sorts NULL as 0, ties by name", () => {
    const rows = [
      row("b", { total: block({ cpa: null }) }),
      row("a", { total: block({ cpa: 5 }) }),
      row("c", { total: block({ cpa: 0 }) }),
    ];
    expect(sort(rows, "total.cpa", "desc")).toEqual(["a", "b", "c"]); // null & 0 tie → name
    expect(sort(rows, "total.cpa", "asc")).toEqual(["b", "c", "a"]);
  });

  it("per-platform metrics read that platform's block (missing block = 0)", () => {
    const rows = [
      row("a", { perPlatform: { instagram: block({ spend: 10 }) } }),
      row("b", { perPlatform: {} }),
      row("c", { perPlatform: { instagram: block({ spend: 30 }) } }),
    ];
    expect(sort(rows, "instagram.spend", "desc")).toEqual(["c", "a", "b"]);
  });

  it("Creator and Launch date follow Postgres NULLs: last ascending, first descending", () => {
    const rows = [
      row("a", { creatorName: "Zed", launchDate: "2026-02-01" }),
      row("b", { creatorName: null, launchDate: null }),
      row("c", { creatorName: "Amy", launchDate: "2026-03-01" }),
    ];
    expect(sort(rows, "creator", "asc")).toEqual(["c", "a", "b"]);
    expect(sort(rows, "creator", "desc")).toEqual(["b", "a", "c"]);
    expect(sort(rows, "launch", "asc")).toEqual(["a", "c", "b"]);
    expect(sort(rows, "launch", "desc")).toEqual(["b", "c", "a"]);
  });

  it("status by rank, priority and stage unset LAST both ways", () => {
    const rows = [
      row("t", { generalStatus: "terminated", priority: 1, stages: ["Retargeting"] }),
      row("n", { generalStatus: "new", priority: null, stages: [] }),
      row("a", { generalStatus: "active", priority: 3, stages: ["Awareness"] }),
    ];
    expect(sort(rows, "status", "asc")).toEqual(["a", "n", "t"]);
    expect(sort(rows, "priority", "asc")).toEqual(["t", "a", "n"]);
    expect(sort(rows, "priority", "desc")).toEqual(["a", "t", "n"]);
    expect(sort(rows, "stage", "desc")).toEqual(["t", "a", "n"]);
  });

  it("a per-platform status counts absence as New", () => {
    const rows = [
      row("x", { perPlatformStatus: {} }),
      row("y", { perPlatformStatus: { tiktok: "active" } }),
      row("z", { perPlatformStatus: { tiktok: "terminated" } }),
    ];
    expect(sort(rows, "tiktok.status", "asc")).toEqual(["y", "x", "z"]);
  });

  it("never mutates its input", () => {
    const rows = [row("b"), row("a")];
    sort(rows, "name", "asc");
    expect(names(rows)).toEqual(["b", "a"]);
  });
});

describe("the Ads column params — read and written in the saved-view shape", () => {
  it("a URL with none of the four params states nothing (the server's resolution stands)", () => {
    expect(adsColumnsFromParams(new URLSearchParams("from=2026-01-01"))).toBeNull();
  });

  it("round-trips, dropping unknown keys like the validator", () => {
    const p = new URLSearchParams("hideIdentity=product,bogus&hideMetrics=ctr&hideRate=1");
    expect(adsColumnsFromParams(p)).toEqual({
      identity: ["product"],
      metrics: ["ctr"],
      rate: true,
      blended: false,
    });
    const out = new URLSearchParams("sort=name");
    writeAdsColumnParams(out, { identity: [], metrics: ["cpm"], rate: false, blended: true });
    expect(out.toString()).toBe("sort=name&hideMetrics=cpm&hideBlended=1");
  });
});
