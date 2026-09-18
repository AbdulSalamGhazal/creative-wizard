import { describe, expect, it } from "vitest";
import {
  PRIORITY_FILTER_LABEL,
  PRIORITY_FILTER_VALUES,
  comparePriority,
  splitPriorityFilter,
} from "@/lib/priority";
import { creativeListFiltersSchema } from "@/validators/creative";
import { summaryFiltersSchema } from "@/validators/summary";

describe("the priority filter vocabulary", () => {
  it("offers 3 · 2 · 1 · Unrated, each labelled", () => {
    expect(PRIORITY_FILTER_VALUES).toEqual(["3", "2", "1", "unrated"]);
    for (const v of PRIORITY_FILTER_VALUES) {
      expect(PRIORITY_FILTER_LABEL[v]).toBeTruthy();
    }
  });

  it("splits tokens into numbers and the unrated flag", () => {
    expect(splitPriorityFilter(["3", "1"])).toEqual({ numbers: [3, 1], unrated: false });
    expect(splitPriorityFilter(["unrated"])).toEqual({ numbers: [], unrated: true });
    expect(splitPriorityFilter(["2", "unrated", "2"])).toEqual({
      numbers: [2],
      unrated: true,
    });
    // Junk from a hand-edited URL is dropped, valid siblings survive.
    expect(splitPriorityFilter(["9", "0", "3", "x"])).toEqual({
      numbers: [3],
      unrated: false,
    });
    expect(splitPriorityFilter([])).toEqual({ numbers: [], unrated: false });
  });
});

describe("unrated sorts LAST in both directions", () => {
  const sortWith = (dir: 1 | -1) =>
    [3, null, 1, null, 2]
      .slice()
      .sort((a, b) => comparePriority(a, b, dir));

  it("descending: 3 → 1, then the unrated", () => {
    expect(sortWith(-1)).toEqual([3, 2, 1, null, null]);
  });

  it("ascending: 1 → 3, and the unrated STILL come last", () => {
    // An unrated creative hasn't been judged — it is not "the least important".
    expect(sortWith(1)).toEqual([1, 2, 3, null, null]);
  });

  it("is 0 between two unrated, and between equal values", () => {
    expect(comparePriority(null, null, 1)).toBe(0);
    expect(comparePriority(2, 2, -1)).toBe(0);
  });
});

describe("the filter parses additively on both surfaces", () => {
  it("Library: absent param = no filter, junk tokens drop", () => {
    expect(creativeListFiltersSchema.parse({}).priorities).toEqual([]);
    expect(creativeListFiltersSchema.parse({ priorities: "3,unrated" }).priorities).toEqual([
      "3",
      "unrated",
    ]);
    expect(creativeListFiltersSchema.parse({ priorities: "9,2" }).priorities).toEqual(["2"]);
  });

  it("Ads: a saved view written BEFORE this feature still round-trips", () => {
    // The exact shape a stored view config has: no `priorities` key at all.
    const saved = {
      from: "2026-01-01",
      to: "2026-01-31",
      platforms: "instagram,facebook",
      types: "video",
      sort: "total.spend",
      dir: "desc",
    };
    const parsed = summaryFiltersSchema.parse(saved);
    expect(parsed.priorities).toEqual([]); // absent = no filter, nothing throws
    expect(parsed.platforms).toEqual(["instagram", "facebook"]);
    expect(parsed.sort).toBe("total.spend");

    expect(summaryFiltersSchema.parse({ priorities: "2,unrated" }).priorities).toEqual([
      "2",
      "unrated",
    ]);
  });

  it("Ads: Priority is a hideable identity column, like its siblings", () => {
    expect(summaryFiltersSchema.parse({ hideIdentity: "priority,type" }).hideIdentity).toEqual([
      "priority",
      "type",
    ]);
  });
});
