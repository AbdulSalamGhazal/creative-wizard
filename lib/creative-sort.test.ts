import { describe, expect, it } from "vitest";
import { creativeSortValues } from "@/validators/creative";
import { compareText, sortCreativeRows, type CreativeSortRow } from "@/lib/creative-sort";

/**
 * The ONE Library order (W2-4 + D12): the server lists with it, the pager
 * walks it, and the client re-sorts with it — so each rule the old SQL
 * `ORDER BY` encoded is pinned here, value by value.
 */
const row = (over: Partial<CreativeSortRow> & { name: string }): CreativeSortRow => ({
  productName: "P",
  type: "video",
  status: "active",
  launchDate: null,
  angles: [],
  spend7d: 0,
  spend30d: 0,
  priority: null,
  stages: [],
  createdAt: "2026-01-01T00:00:00Z",
  ...over,
});
const names = (rows: CreativeSortRow[]) => rows.map((r) => r.name);

describe("sortCreativeRows — every ?sort= value", () => {
  it("launch date: newest/oldest first, undated LAST both ways, ties by name", () => {
    const rows = [
      row({ name: "c", launchDate: null }),
      row({ name: "b", launchDate: "2026-02-01" }),
      row({ name: "a", launchDate: "2026-02-01" }),
      row({ name: "d", launchDate: "2026-03-01" }),
    ];
    expect(names(sortCreativeRows(rows, "launched-desc"))).toEqual(["d", "a", "b", "c"]);
    expect(names(sortCreativeRows(rows, "launched-asc"))).toEqual(["a", "b", "d", "c"]);
  });

  it("product / type / name, each ending on the name", () => {
    const rows = [
      row({ name: "b", productName: "Rose", type: "image" }),
      row({ name: "a", productName: "Rose", type: "video" }),
      row({ name: "c", productName: "Argan", type: "slides" }),
    ];
    expect(names(sortCreativeRows(rows, "product-asc"))).toEqual(["c", "a", "b"]);
    expect(names(sortCreativeRows(rows, "product-desc"))).toEqual(["a", "b", "c"]);
    expect(names(sortCreativeRows(rows, "type-asc"))).toEqual(["b", "c", "a"]);
    expect(names(sortCreativeRows(rows, "name-desc"))).toEqual(["c", "b", "a"]);
  });

  it("status by rank (active ▸ pause ▸ new ▸ terminated), priority and stage unset LAST", () => {
    const rows = [
      row({ name: "t", status: "terminated", priority: 1, stages: ["Retargeting"] }),
      row({ name: "n", status: "new", priority: null, stages: [] }),
      row({ name: "a", status: "active", priority: 3, stages: ["Awareness"] }),
      row({ name: "p", status: "pause", priority: 2, stages: ["Activation"] }),
    ];
    expect(names(sortCreativeRows(rows, "status-asc"))).toEqual(["a", "p", "n", "t"]);
    expect(names(sortCreativeRows(rows, "status-desc"))).toEqual(["t", "n", "p", "a"]);
    expect(names(sortCreativeRows(rows, "priority-desc"))).toEqual(["a", "p", "t", "n"]);
    expect(names(sortCreativeRows(rows, "priority-asc"))).toEqual(["t", "p", "a", "n"]);
    expect(names(sortCreativeRows(rows, "stage-asc"))).toEqual(["a", "p", "t", "n"]);
    expect(names(sortCreativeRows(rows, "stage-desc"))).toEqual(["t", "p", "a", "n"]);
  });

  it("angle by its FIRST angle in text order, no angle LAST both ways", () => {
    const rows = [
      row({ name: "x", angles: [] }),
      row({ name: "y", angles: ["ugc", "launch"] }), // first = launch
      row({ name: "z", angles: ["hook"] }),
    ];
    expect(names(sortCreativeRows(rows, "angle-asc"))).toEqual(["z", "y", "x"]);
    expect(names(sortCreativeRows(rows, "angle-desc"))).toEqual(["y", "z", "x"]);
  });

  it("spend windows and created, ties by name", () => {
    const rows = [
      row({ name: "b", spend7d: 5, spend30d: 50, createdAt: "2026-01-02T00:00:00Z" }),
      row({ name: "a", spend7d: 5, spend30d: 10, createdAt: "2026-01-03T00:00:00Z" }),
      row({ name: "c", spend7d: 0, spend30d: 0, createdAt: new Date("2026-01-01T00:00:00Z") }),
    ];
    expect(names(sortCreativeRows(rows, "spend7-desc"))).toEqual(["a", "b", "c"]);
    expect(names(sortCreativeRows(rows, "spend7-asc"))).toEqual(["c", "a", "b"]);
    expect(names(sortCreativeRows(rows, "spend-desc"))).toEqual(["b", "a", "c"]);
    expect(names(sortCreativeRows(rows, "created-desc"))).toEqual(["a", "b", "c"]);
  });

  it("covers every sort value, and never mutates its input", () => {
    const rows = [row({ name: "b" }), row({ name: "a" })];
    for (const sort of creativeSortValues) {
      expect(sortCreativeRows(rows, sort)).toHaveLength(2);
    }
    expect(names(rows)).toEqual(["b", "a"]);
  });

  it("text order is one explicit collator, whatever the runtime's locale", () => {
    expect(compareText("a", "B")).toBeLessThan(0);
    expect(compareText("URJ_VID_002", "URJ_VID_010")).toBeLessThan(0);
    expect(compareText("سارة", "سارة")).toBe(0);
  });
});
