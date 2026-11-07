import { describe, expect, it } from "vitest";
import { statusEvents, visibleStatusEvents } from "@/lib/entity-activity";

describe("statusEvents — went live / stopped, by the badge's own rule", () => {
  it("one run still inside the window is live, with no stop", () => {
    expect(statusEvents({ facebook: ["2026-10-01", "2026-10-02"] }, { facebook: "2026-10-04" }, 3)).toEqual([
      { platform: "facebook", kind: "live", day: "2026-10-01" },
    ]);
  });

  it("stops on the first day past the window, once that day has arrived", () => {
    // Last spend 10-02, window 3 → live through 10-04, Pause on 10-05.
    expect(statusEvents({ facebook: ["2026-10-01", "2026-10-02"] }, { facebook: "2026-10-05" }, 3)).toEqual([
      { platform: "facebook", kind: "stopped", day: "2026-10-05", lastSpend: "2026-10-02" },
      { platform: "facebook", kind: "live", day: "2026-10-01" },
    ]);
  });

  it("a gap the window covers is one run; a longer gap is two", () => {
    // Window 3: 10-01 → 10-04 (spends again on the day it would pause) stays one run.
    expect(
      statusEvents({ tiktok: ["2026-10-01", "2026-10-04"] }, { tiktok: "2026-10-04" }, 3).map((e) => e.kind),
    ).toEqual(["live"]);
    // 10-01 → 10-05: Pause on 10-04, live again 10-05.
    expect(statusEvents({ tiktok: ["2026-10-01", "2026-10-05"] }, { tiktok: "2026-10-05" }, 3)).toEqual([
      { platform: "tiktok", kind: "live", day: "2026-10-05" },
      { platform: "tiktok", kind: "stopped", day: "2026-10-04", lastSpend: "2026-10-01" },
      { platform: "tiktok", kind: "live", day: "2026-10-01" },
    ]);
  });

  it("judges each platform against its OWN latest day", () => {
    const events = statusEvents(
      { facebook: ["2026-10-01"], google: ["2026-10-01"] },
      { facebook: "2026-10-01", google: "2026-10-20" },
      1,
    );
    expect(events.filter((e) => e.platform === "facebook").map((e) => e.kind)).toEqual(["live"]);
    expect(events.filter((e) => e.platform === "google").map((e) => e.kind)).toEqual(["stopped", "live"]);
  });

  it("no spend, no events", () => {
    expect(statusEvents({}, {}, 1)).toEqual([]);
    expect(statusEvents({ facebook: [] }, { facebook: "2026-10-01" }, 1)).toEqual([]);
  });
});

describe("visibleStatusEvents — never ahead of the audit rows loaded", () => {
  const events = statusEvents(
    { facebook: ["2026-09-01", "2026-10-20"] },
    { facebook: "2026-10-21" },
    1,
  );

  it("shows only events no older than the oldest loaded row until every page is in", () => {
    const shown = visibleStatusEvents(events, new Date("2026-10-15T12:00:00Z"), false);
    expect(shown.every((e) => e.day >= "2026-10-15")).toBe(true);
    expect(shown.length).toBeGreaterThan(0);
  });

  it("shows them all once everything is loaded, even with no audit rows", () => {
    expect(visibleStatusEvents(events, null, true)).toEqual(events);
    expect(visibleStatusEvents(events, null, false)).toEqual([]);
  });
});
