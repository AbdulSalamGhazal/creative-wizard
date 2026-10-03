import { describe, expect, it } from "vitest";
import {
  BADGE_CAP,
  CATEGORY_LABEL,
  COMMENT_EVENT_TYPES,
  DEFAULT_TOAST_SCOPE,
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
  anchorLabelFromTitle,
  burstLabel,
  dayGroupLabel,
  groupNotifications,
  isNotificationCategory,
  isPersonalNotification,
  utcDay,
  isToastScope,
  newArrivals,
  safeHref,
  shouldToast,
  stripUnreadPrefix,
  titleWithUnread,
  toToastScope,
  toastPlan,
  toastedStorageKey,
  burstSummary,
  TOAST_BURST_LIMIT,
  TOAST_SCOPES,
  TOAST_SCOPE_HINT,
  TOAST_SCOPE_LABEL,
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

// ── Arrival toasts (2026-09) ─────────────────────────────────────────────────

describe("what counts as PERSONAL", () => {
  it("is a mention or a reply — somebody wrote to you", () => {
    expect(isPersonalNotification({ category: "mention" })).toBe(true);
    expect(isPersonalNotification({ category: "reply" })).toBe(true);
    expect(isPersonalNotification({ type: COMMENT_EVENT_TYPES.MENTION })).toBe(true);
    expect(isPersonalNotification({ type: COMMENT_EVENT_TYPES.REPLY })).toBe(true);
  });

  it("is a DIRECT event, whose category is nonetheless 'system'", () => {
    const type = DIRECT_EVENT_TYPES.BRAND_GRANTED;
    expect(categoryForType(type)).toBe("system");
    expect(isPersonalNotification({ type, category: "system" })).toBe(true);
  });

  it("is NOT a routed system event — those went to a list, not to you", () => {
    for (const e of EVENT_TYPES) {
      expect(isPersonalNotification({ type: e.key, category: e.category })).toBe(false);
    }
    expect(isPersonalNotification({ category: "alert" })).toBe(false);
    expect(isPersonalNotification({ category: "reminder" })).toBe(false);
    expect(isPersonalNotification({})).toBe(false);
  });
});

describe("the toast scope setting", () => {
  it("has a label and a hint for every option, and defaults to personal", () => {
    expect(TOAST_SCOPES).toEqual(["personal", "all", "off"]);
    for (const s of TOAST_SCOPES) {
      expect(TOAST_SCOPE_LABEL[s]).toBeTruthy();
      expect(TOAST_SCOPE_HINT[s]).toBeTruthy();
    }
    expect(DEFAULT_TOAST_SCOPE).toBe("personal");
  });

  it("reads a junk or retired stored value as the default", () => {
    expect(isToastScope("all")).toBe(true);
    expect(isToastScope("ALL")).toBe(false);
    expect(toToastScope("off")).toBe("off");
    expect(toToastScope("whispers")).toBe("personal");
    expect(toToastScope(null)).toBe("personal");
  });

  it("scopes one item: off silences everything, all passes everything", () => {
    const mention = { category: "mention", type: COMMENT_EVENT_TYPES.MENTION };
    const system = { category: "system", type: "upload.committed" };
    expect(shouldToast(mention, "off")).toBe(false);
    expect(shouldToast(system, "off")).toBe(false);
    expect(shouldToast(mention, "all")).toBe(true);
    expect(shouldToast(system, "all")).toBe(true);
    expect(shouldToast(mention, "personal")).toBe(true);
    expect(shouldToast(system, "personal")).toBe(false);
  });

  it("keys the toasted pointer per brand", () => {
    expect(toastedStorageKey("acct-a")).not.toBe(toastedStorageKey("acct-b"));
    expect(toastedStorageKey("acct-a")).toContain("acct-a");
  });
});

describe("which arrivals are NEW", () => {
  // Newest first, as the feed returns them.
  const feed = [
    { id: "n5", category: "mention" as const },
    { id: "n4", category: "system" as const },
    { id: "n3", category: "system" as const },
    { id: "n2", category: "system" as const },
    { id: "n1", category: "system" as const },
  ];

  it("NOTHING on first load — opening the app is not an event", () => {
    expect(newArrivals(feed, null)).toEqual([]);
    expect(toastPlan(feed, null, "all")).toEqual({ kind: "none" });
  });

  it("is everything ahead of the pointer", () => {
    expect(newArrivals(feed, "n3").map((i) => i.id)).toEqual(["n5", "n4"]);
    expect(newArrivals(feed, "n5")).toEqual([]);
  });

  it("treats a pointer that fell out of the window as 'all of these'", () => {
    // More arrived than the feed returns, or the pointer was archived.
    expect(newArrivals(feed, "gone").map((i) => i.id)).toEqual([
      "n5",
      "n4",
      "n3",
      "n2",
      "n1",
    ]);
  });

  it("never toasts something already read elsewhere", () => {
    const withRead = [{ id: "n6", category: "mention" as const, read: true }, ...feed];
    expect(newArrivals(withRead, "n4").map((i) => i.id)).toEqual(["n5"]);
  });

  it("handles an empty feed", () => {
    expect(newArrivals([], "n3")).toEqual([]);
    expect(toastPlan([], "n3", "all")).toEqual({ kind: "none" });
  });
});

describe("the toast plan", () => {
  const feed = [
    { id: "n5", category: "mention" as const },
    { id: "n4", category: "system" as const },
    { id: "n3", category: "system" as const },
    { id: "n2", category: "system" as const },
    { id: "n1", category: "system" as const },
  ];

  it("filters by scope BEFORE counting the burst", () => {
    // Four arrivals, one of them personal → one toast on the default setting.
    const plan = toastPlan(feed, "n1", "personal");
    expect(plan).toEqual({ kind: "items", items: [{ id: "n5", category: "mention" }] });
  });

  it("collapses a burst past the limit into ONE summary", () => {
    const plan = toastPlan(feed, "n1", "all");
    expect(plan).toEqual({ kind: "summary", count: 4 });
    expect(TOAST_BURST_LIMIT).toBe(3);
  });

  it("keeps exactly the limit as individual toasts, oldest first", () => {
    const plan = toastPlan(feed, "n2", "all");
    expect(plan.kind).toBe("items");
    // Oldest first, so a stack reads in the order things happened.
    expect(plan.kind === "items" && plan.items.map((i) => i.id)).toEqual([
      "n3",
      "n4",
      "n5",
    ]);
  });

  it("is silent when the setting is off, however much arrives", () => {
    expect(toastPlan(feed, "n1", "off")).toEqual({ kind: "none" });
  });

  it("phrases the summary in English", () => {
    expect(burstSummary(4)).toBe("4 new notifications");
    expect(burstSummary(1)).toBe("1 new notification");
  });
});

describe("the tab title", () => {
  it("prefixes the unread count, capped like the badge", () => {
    expect(titleWithUnread("Ads", 3)).toBe("(3) Ads");
    expect(titleWithUnread("Ads", 12)).toBe(`(${BADGE_CAP}+) Ads`);
  });

  it("is the plain title at zero", () => {
    expect(titleWithUnread("Ads", 0)).toBe("Ads");
    expect(titleWithUnread("Ads", -1)).toBe("Ads");
  });

  it("never stacks prefixes when re-applied after a route change", () => {
    const once = titleWithUnread("Ads", 3);
    expect(titleWithUnread(once, 4)).toBe("(4) Ads");
    expect(titleWithUnread(once, 0)).toBe("Ads");
    expect(stripUnreadPrefix("(9+) Library")).toBe("Library");
    expect(stripUnreadPrefix("Library")).toBe("Library");
  });
});

// ── The page's reading aids (2026-10) ───────────────────────────────────────

describe("day groups", () => {
  const today = "2026-10-04";

  it("names today and yesterday, and dates everything older", () => {
    expect(dayGroupLabel("2026-10-04", today)).toBe("Today");
    expect(dayGroupLabel("2026-10-03", today)).toBe("Yesterday");
    expect(dayGroupLabel("2026-09-28", today)).toBe("Sep 28, 2026");
  });

  it("reads the day in UTC, not the machine's timezone", () => {
    // 23:30Z belongs to the 4th wherever the reader happens to be sitting.
    expect(utcDay("2026-10-04T23:30:00.000Z")).toBe("2026-10-04");
    expect(utcDay(new Date("2026-10-04T00:05:00.000Z"))).toBe("2026-10-04");
  });
});

describe("burst collapse", () => {
  const today = "2026-10-04";
  const row = (
    id: string,
    at: string,
    entity: [string, string] | null = ["creative", "c1"],
  ) => ({
    id,
    createdAt: `${at}T10:00:00.000Z`,
    entityType: entity?.[0] ?? null,
    entityId: entity?.[1] ?? null,
  });

  it("folds a consecutive same-anchor run into ONE item", () => {
    const groups = groupNotifications(
      [
        row("a", "2026-10-04"),
        row("b", "2026-10-04"),
        row("c", "2026-10-04"),
      ],
      today,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items).toHaveLength(1);
    expect(groups[0]!.items[0]!.collapsed).toBe(true);
    expect(groups[0]!.items[0]!.rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("leaves a SINGLE row untouched — nothing hides behind a disclosure", () => {
    const groups = groupNotifications([row("a", "2026-10-04")], today);
    expect(groups[0]!.items[0]!.collapsed).toBe(false);
    expect(groups[0]!.items[0]!.rows).toHaveLength(1);
  });

  it("breaks a run when something unrelated lands between", () => {
    const groups = groupNotifications(
      [
        row("a", "2026-10-04"),
        row("x", "2026-10-04", ["campaign", "k1"]),
        row("b", "2026-10-04"),
      ],
      today,
    );
    // Chronology wins: three items, none collapsed.
    expect(groups[0]!.items.map((i) => i.rows.length)).toEqual([1, 1, 1]);
  });

  it("NEVER merges across a day — yesterday's five aren't today's", () => {
    const groups = groupNotifications(
      [
        row("a", "2026-10-04"),
        row("b", "2026-10-04"),
        row("c", "2026-10-03"),
        row("d", "2026-10-03"),
      ],
      today,
    );
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday"]);
    expect(groups[0]!.items[0]!.rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(groups[1]!.items[0]!.rows.map((r) => r.id)).toEqual(["c", "d"]);
  });

  it("never groups rows with no anchor, however many there are", () => {
    const groups = groupNotifications(
      [row("a", "2026-10-04", null), row("b", "2026-10-04", null)],
      today,
    );
    expect(groups[0]!.items).toHaveLength(2);
    expect(groups[0]!.items.every((i) => !i.collapsed)).toBe(true);
  });

  it("keeps the feed's order inside and between groups", () => {
    const groups = groupNotifications(
      [
        row("a", "2026-10-04"),
        row("b", "2026-10-04"),
        row("x", "2026-10-04", ["campaign", "k1"]),
        row("y", "2026-10-02", ["campaign", "k1"]),
      ],
      today,
    );
    expect(groups.map((g) => g.day)).toEqual(["2026-10-04", "2026-10-02"]);
    expect(groups[0]!.items.map((i) => i.rows[0]!.id)).toEqual(["a", "x"]);
  });

  it("phrases the collapsed line, with and without a name", () => {
    expect(burstLabel(5, "Hero v2")).toBe("5 updates on Hero v2");
    expect(burstLabel(1, "Hero v2")).toBe("1 update on Hero v2");
    expect(burstLabel(3, null)).toBe("3 updates");
  });

  it("reads the anchor name back out of a comment title, conservatively", () => {
    expect(
      anchorLabelFromTitle("Sara mentioned you on Hero v2", COMMENT_EVENT_TYPES.MENTION),
    ).toBe("Hero v2");
    expect(
      anchorLabelFromTitle(
        "Omar commented on Hero v2 — where you commented",
        COMMENT_EVENT_TYPES.ANCHOR_ACTIVITY,
      ),
    ).toBe("Hero v2");
    // Not the comment family, or not the shape → name nothing rather than guess.
    expect(anchorLabelFromTitle("Ads upload committed", "upload.committed")).toBeNull();
    expect(anchorLabelFromTitle("Something happened", COMMENT_EVENT_TYPES.REPLY)).toBeNull();
  });
});

describe("anchor-following is a reply, with its own type", () => {
  it("categorises as reply, and is personal", () => {
    expect(categoryForType(COMMENT_EVENT_TYPES.ANCHOR_ACTIVITY)).toBe("reply");
    expect(
      isPersonalNotification({ type: COMMENT_EVENT_TYPES.ANCHOR_ACTIVITY }),
    ).toBe(true);
  });
});
