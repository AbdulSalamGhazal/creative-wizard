import { describe, expect, it } from "vitest";
import {
  BADGE_CAP,
  CATEGORY_LABEL,
  DIRECT_EVENT_TYPES,
  EVENT_TYPES,
  EVENT_TYPE_KEYS,
  NOTIFICATIONS_PAGE_SIZE,
  NOTIFICATION_CATEGORIES,
  POLL_MS,
  badgeCount,
  categoryForType,
  eventMeta,
  isEventType,
  isNotificationCategory,
  safeHref,
} from "@/lib/notifications";

describe("the catalog", () => {
  it("carries all five categories from day one, phase 1 or not", () => {
    expect(NOTIFICATION_CATEGORIES).toEqual([
      "system",
      "mention",
      "reply",
      "alert",
      "reminder",
    ]);
    for (const c of NOTIFICATION_CATEGORIES) expect(CATEGORY_LABEL[c]).toBeTruthy();
    expect(isNotificationCategory("mention")).toBe(true);
    expect(isNotificationCategory("everything")).toBe(false);
  });

  it("derives its key list, and every entry is complete and unique", () => {
    expect(EVENT_TYPE_KEYS).toEqual(EVENT_TYPES.map((e) => e.key));
    expect(new Set(EVENT_TYPE_KEYS).size).toBe(EVENT_TYPES.length);
    for (const e of EVENT_TYPES) {
      expect(e.label.length).toBeGreaterThan(0);
      expect(e.description.length).toBeGreaterThan(0);
      expect(isNotificationCategory(e.category)).toBe(true);
      expect(isEventType(e.key)).toBe(true);
    }
    // Phase 1 produces system notifications only — the rest of the axis is
    // reserved for phases 2 and 3.
    expect(EVENT_TYPES.every((e) => e.category === "system")).toBe(true);
  });

  it("looks an event up, and shrugs at one it doesn't know", () => {
    expect(eventMeta("budget.plan_saved")?.label).toBe("Budget plan saved");
    expect(eventMeta("nope.not_a_thing")).toBeNull();
    expect(isEventType("nope.not_a_thing")).toBe(false);
    // The direct event is deliberately NOT routable.
    expect(isEventType(DIRECT_EVENT_TYPES.BRAND_GRANTED)).toBe(false);
  });

  it("maps a stored type to its category, including retired ones", () => {
    expect(categoryForType("upload.committed")).toBe("system");
    expect(categoryForType(DIRECT_EVENT_TYPES.BRAND_GRANTED)).toBe("system");
    // A row outlives its catalog entry; the page must still file it somewhere.
    expect(categoryForType("retired.event")).toBe("system");
  });
});

describe("the badge", () => {
  it("says nothing at zero, counts up to the cap, then stops", () => {
    expect(badgeCount(0)).toBe("");
    expect(badgeCount(-3)).toBe("");
    expect(badgeCount(1)).toBe("1");
    expect(badgeCount(BADGE_CAP)).toBe(String(BADGE_CAP));
    expect(badgeCount(BADGE_CAP + 1)).toBe(`${BADGE_CAP}+`);
    expect(badgeCount(4_000)).toBe(`${BADGE_CAP}+`);
    expect(badgeCount(Number.NaN)).toBe("");
  });
});

describe("hrefs are data, not trust", () => {
  it("follows in-app paths only", () => {
    expect(safeHref("/budget/plan?month=2026-09")).toBe("/budget/plan?month=2026-09");
    expect(safeHref(null)).toBeNull();
    expect(safeHref("")).toBeNull();
    // An absolute or protocol-relative URL would make the bell an open
    // redirect — dropped, not navigated to.
    expect(safeHref("https://example.com/phish")).toBeNull();
    expect(safeHref("//example.com/phish")).toBeNull();
    expect(safeHref("javascript:alert(1)")).toBeNull();
  });
});

describe("tuning knobs are single constants", () => {
  it("keeps the poll interval and page size in one place", () => {
    expect(POLL_MS).toBeGreaterThanOrEqual(5_000);
    expect(NOTIFICATIONS_PAGE_SIZE).toBe(50);
  });
});
