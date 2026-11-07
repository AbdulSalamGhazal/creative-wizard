import { describe, expect, it } from "vitest";
import { soloFlips } from "@/components/charts/series-legend";

const items = [{ key: "a" }, { key: "b" }, { key: "c" }];

describe("SeriesLegend solo (R-085)", () => {
  it("hides every other series and shows the soloed one", () => {
    expect(soloFlips(items, new Set(["a", "b", "c"]), "b")).toEqual(["a", "c"]);
    expect(soloFlips(items, new Set(["a"]), "c")).toEqual(["a", "c"]);
  });
  it("soloing the series already alone brings every series back", () => {
    expect(soloFlips(items, new Set(["b"]), "b")).toEqual(["a", "c"]);
  });
});
