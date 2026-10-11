import { describe, expect, it } from "vitest";
import {
  ASC_FIRST,
  compareRows,
  firstDir,
  type LaunchFatigueViewRow,
} from "@/components/trends/launch-fatigue";
import {
  FATIGUE_WINDOWS,
  type FatigueTier,
  type FatigueWindowMetrics,
} from "@/lib/launch-fatigue";

/**
 * The launch-fatigue table moved onto `DataTable` (2026-10). Its ORDER is the
 * one thing that had to survive byte for byte, so this pins the comparator
 * that still produces it — including the parts a generic `sortValue` could
 * never express (status is a composite) and the parts that are arguably odd
 * but are what the table has always done (a window with no ROAS sorts as 0,
 * NOT last).
 */

const win = (roas: number | null): FatigueWindowMetrics => ({
  roas,
  spend: 0,
  ctr: null,
  cpa: null,
  cvr: null,
  hasData: roas !== null,
});

function row(over: {
  name?: string;
  launchDate?: string;
  tier?: FatigueTier;
  drop?: number | null;
  w1?: number | null;
  w2?: number | null;
  w3?: number | null;
  spend?: number;
}): LaunchFatigueViewRow {
  const spend = over.spend ?? 0;
  return {
    creativeId: over.name ?? "id",
    name: over.name ?? "A",
    productName: "Serum",
    type: "video",
    launchDate: over.launchDate ?? "2026-09-01",
    derived: false,
    daysSinceLaunch: 40,
    href: "/library/x",
    assessment: {
      tier: over.tier ?? "holding",
      drop: over.drop === undefined ? null : over.drop,
      w1: { ...win(over.w1 ?? null), spend },
      w2: win(over.w2 ?? null),
      w3: win(over.w3 ?? null),
      latestWindow: null,
    },
  };
}

const sortBy = (rows: LaunchFatigueViewRow[], key: Parameters<typeof compareRows>[2], dir: "asc" | "desc" = "asc") =>
  [...rows]
    .sort((a, b) => (dir === "asc" ? compareRows(a, b, key) : -compareRows(a, b, key)))
    .map((r) => r.name);

describe("first-click direction", () => {
  it("is ascending for the three text-ish columns, descending for the rest", () => {
    expect([...ASC_FIRST].sort()).toEqual(["creative", "launched", "status"]);
    for (const key of ["status", "creative", "launched"] as const) {
      expect(firstDir(key)).toBe("asc");
    }
    for (const key of ["spend", "fatigue", ...FATIGUE_WINDOWS.map((w) => w.key)] as const) {
      expect(firstDir(key)).toBe("desc");
    }
  });
});

describe("the status order — the table's default", () => {
  it("is tier first, then the biggest drop, then the newest launch", () => {
    const rows = [
      row({ name: "holding", tier: "holding", drop: 0.5 }),
      row({ name: "fatigued-small", tier: "fatigued", drop: 0.2 }),
      row({ name: "fatigued-big", tier: "fatigued", drop: 0.9 }),
      row({ name: "new", tier: "new" }),
    ];
    expect(sortBy(rows, "status")).toEqual([
      "fatigued-big",
      "fatigued-small",
      "holding",
      "new",
    ]);
  });

  it("puts a null drop LAST within its tier, and breaks ties by newest launch", () => {
    const rows = [
      row({ name: "no-drop", tier: "fatigued", drop: null }),
      row({ name: "has-drop", tier: "fatigued", drop: 0.1 }),
      row({ name: "old-tie", tier: "fatigued", drop: 0.1, launchDate: "2026-08-01" }),
    ];
    // Same drop → the NEWER launch leads; the unmeasurable one sinks.
    expect(sortBy(rows, "status")).toEqual(["has-drop", "old-tie", "no-drop"]);
  });
});

describe("the other columns", () => {
  it("sorts creative by name and launched by date", () => {
    const rows = [row({ name: "B" }), row({ name: "A" }), row({ name: "C" })];
    expect(sortBy(rows, "creative")).toEqual(["A", "B", "C"]);
    expect(sortBy(rows, "creative", "desc")).toEqual(["C", "B", "A"]);

    const dated = [
      row({ name: "mid", launchDate: "2026-06-15" }),
      row({ name: "old", launchDate: "2026-01-01" }),
      row({ name: "new", launchDate: "2026-09-30" }),
    ];
    expect(sortBy(dated, "launched")).toEqual(["old", "mid", "new"]);
  });

  it("sorts spend by the assessment's own total", () => {
    const rows = [
      row({ name: "big", spend: 900 }),
      row({ name: "small", spend: 10 }),
    ];
    expect(sortBy(rows, "spend", "desc")).toEqual(["big", "small"]);
  });

  it("treats a window with NO ROAS as zero — not as missing (today's behaviour)", () => {
    // Worth pinning precisely because it differs from DataTable's own
    // nulls-last rule: this table sorts through `compareRows`, so the
    // migration kept the old semantics rather than quietly adopting new ones.
    const rows = [
      row({ name: "none", w2: null }),
      row({ name: "neg", w2: -1 }),
      row({ name: "pos", w2: 2 }),
    ];
    expect(sortBy(rows, "w2", "desc")).toEqual(["pos", "none", "neg"]);
  });

  it("sorts fatigue by drop, with a null drop as zero", () => {
    const rows = [
      row({ name: "worst", drop: 0.8 }),
      row({ name: "none", drop: null }),
      row({ name: "improved", drop: -0.3 }),
    ];
    expect(sortBy(rows, "fatigue", "desc")).toEqual(["worst", "none", "improved"]);
  });
});

describe("the window columns derive from the vocabulary", () => {
  it("compares every declared window, so a fourth needs no change here", () => {
    for (const w of FATIGUE_WINDOWS) {
      const rows = [row({ name: "lo", [w.key]: 1 }), row({ name: "hi", [w.key]: 5 })];
      expect(sortBy(rows, w.key, "desc")).toEqual(["hi", "lo"]);
    }
  });
});
