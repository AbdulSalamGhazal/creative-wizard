import { describe, expect, it, vi } from "vitest";

// The module is the client half of the write-through preferences; only its
// pure rules are under test here, so the action and the router are stubbed.
vi.mock("@/app/actions/user-prefs", () => ({
  setPreferredRange: vi.fn(async () => ({ ok: true })),
  setIncludeExcludedPref: vi.fn(async () => ({ ok: true })),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { excludedIsBehind, rangeIsBehind } from "@/lib/pref-sync";

describe("a page restored by Back/Forward with an older default (W2-1)", () => {
  const today = "2026-10-24";

  it("is behind when it shows another range than the one this tab saved", () => {
    // "30" decodes to the 30 days before today — not the last week.
    expect(rangeIsBehind({ from: "2026-10-17", to: "2026-10-23" }, "30", today)).toBe(true);
    expect(rangeIsBehind({ from: "2026-10-17", to: "2026-10-23" }, "7", today)).toBe(false);
    expect(
      rangeIsBehind({ from: "2026-09-01", to: "2026-09-30" }, "custom:2026-09-01..2026-09-30", today),
    ).toBe(false);
  });

  it("is never behind when this tab saved nothing, or the page shows no default", () => {
    expect(rangeIsBehind({ from: "2026-10-17", to: "2026-10-23" }, null, today)).toBe(false);
    expect(rangeIsBehind(undefined, "30", today)).toBe(false);
    // An undecodable value can't be compared, so it never forces a re-read.
    expect(rangeIsBehind({ from: "2026-10-17", to: "2026-10-23" }, "junk", today)).toBe(false);
  });

  it("the Excluded toggle is behind only against a value this tab wrote", () => {
    expect(excludedIsBehind(false, true)).toBe(true);
    expect(excludedIsBehind(true, true)).toBe(false);
    expect(excludedIsBehind(false, null)).toBe(false);
  });
});
