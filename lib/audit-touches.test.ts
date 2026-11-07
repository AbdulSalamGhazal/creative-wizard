import { describe, expect, it } from "vitest";
import {
  TouchCollector,
  addedValues,
  mergeTouches,
  sameMembers,
  selfTouches,
  toBudgetMonth,
  touchRows,
  touchesFromRecords,
} from "@/lib/audit-touches";

describe("toBudgetMonth", () => {
  it("reads a month, a date, a timestamp or a Date", () => {
    expect(toBudgetMonth("2026-10")).toBe("2026-10");
    expect(toBudgetMonth("2026-10-01")).toBe("2026-10");
    expect(toBudgetMonth("2026-10-14T09:00:00Z")).toBe("2026-10");
    expect(toBudgetMonth(new Date("2026-02-03T00:00:00Z"))).toBe("2026-02");
  });
  it("refuses what isn't a month", () => {
    expect(toBudgetMonth("2026-13-01")).toBeNull();
    expect(toBudgetMonth("Oct 2026")).toBeNull();
    expect(toBudgetMonth("")).toBeNull();
    expect(toBudgetMonth(null)).toBeNull();
  });
});

describe("touchRows", () => {
  it("dedupes per type, drops blanks, normalises months, keeps type order", () => {
    expect(
      touchRows({
        budget_month: ["2026-10-01", "2026-10", "nope"],
        campaign: ["k1"],
        creative: ["c1", "c1", " ", "c2"],
      }),
    ).toEqual([
      { entityType: "creative", entityId: "c1" },
      { entityType: "creative", entityId: "c2" },
      { entityType: "campaign", entityId: "k1" },
      { entityType: "budget_month", entityId: "2026-10" },
    ]);
  });
  it("the same id under two types is two links", () => {
    expect(touchRows({ creative: ["x"], campaign: ["x"] })).toHaveLength(2);
  });
  it("nothing in, nothing out", () => {
    expect(touchRows(undefined)).toEqual([]);
    expect(touchRows({})).toEqual([]);
  });
});

describe("mergeTouches", () => {
  it("unions every set, skipping absent ones", () => {
    const m = mergeTouches({ creative: ["a"] }, null, { creative: ["a", "b"], campaign: ["k"] });
    expect(touchRows(m)).toEqual([
      { entityType: "creative", entityId: "a" },
      { entityType: "creative", entityId: "b" },
      { entityType: "campaign", entityId: "k" },
    ]);
  });
});

describe("touchesFromRecords", () => {
  const rows = [
    { creativeId: "c1", campaignId: "k1", date: "2026-01-31" },
    { creativeId: "c1", campaignId: "k2", date: "2026-02-01" },
    { creativeId: "c2", campaignId: "k1", date: "2026-02-15" },
  ];
  it("names the distinct creatives, campaigns and months", () => {
    expect(touchesFromRecords(rows, { months: true })).toEqual({
      creative: ["c1", "c2"],
      campaign: ["k1", "k2"],
      budget_month: ["2026-01", "2026-02"],
    });
  });
  it("leaves months out when the change doesn't move spend (exclusions)", () => {
    expect(touchesFromRecords(rows, { months: false })).not.toHaveProperty("budget_month");
  });
});

describe("TouchCollector", () => {
  it("accumulates across statements", () => {
    const c = new TouchCollector();
    c.add([{ creativeId: "a", campaignId: "k" }]);
    c.add([{ creativeId: "b", campaignId: "k" }]);
    expect(c.size).toBe(2);
    expect(c.touches()).toEqual({ creative: ["a", "b"], campaign: ["k"] });
  });
});

describe("selfTouches — an event links its own entity", () => {
  it("creative and campaign events", () => {
    expect(selfTouches({ action: "creative.update", entityType: "creative", entityId: "c" })).toEqual({ creative: ["c"] });
    expect(selfTouches({ action: "campaign.delete", entityType: "campaign", entityId: "k" })).toEqual({ campaign: ["k"] });
  });
  it("a budget-plan event links its month; the rate (no month) doesn't", () => {
    expect(selfTouches({ action: "budget.update", entityType: "budget", entityId: "2026-10-01" })).toEqual({ budget_month: ["2026-10"] });
    expect(selfTouches({ action: "budget.update", entityType: "budget", entityId: null })).toEqual({});
  });
  it("everything else links nothing by itself", () => {
    expect(selfTouches({ action: "creative.bulk_create", entityType: "creative", entityId: null })).toEqual({});
    expect(selfTouches({ action: "upload.commit", entityType: "upload", entityId: "b" })).toEqual({});
    expect(selfTouches({ action: "angle.rename", entityType: "angle", entityId: "a" })).toEqual({});
  });
});

describe("set diffs", () => {
  it("addedValues is sorted and de-duplicated", () => {
    expect(addedValues(["a", "b"], ["c", "b", "c", "a0"])).toEqual(["a0", "c"]);
  });
  it("sameMembers ignores order and repeats", () => {
    expect(sameMembers(["Awareness", "Retargeting"], ["Retargeting", "Awareness"])).toBe(true);
    expect(sameMembers(["Awareness"], ["Awareness", "Activation"])).toBe(false);
  });
});
