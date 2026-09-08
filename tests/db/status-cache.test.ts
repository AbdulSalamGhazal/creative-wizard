import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A } from "./config";

/**
 * React's `cache()` only dedupes INSIDE a request/render context, which vitest
 * has none of — called from a plain test it invokes the function every time.
 * So the memo is stood in for here with a deterministic per-module one.
 *
 * That is on purpose: what this file pins is the WIRING, not React's
 * implementation. The regression it guards against is a future consumer going
 * back to its own `performance_records` status scan instead of deriving from
 * `brandStatusInputs()` — with the memo in place, that shows up immediately as
 * extra queries.
 */
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
      let memo: R | undefined;
      let called = false;
      return (...args: A): R => {
        if (!called) {
          called = true;
          memo = fn(...args);
        }
        return memo as R;
      };
    },
  };
});

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

import { db } from "@/lib/db";
import { creativeStatusMap, creativeStatusBreakdown } from "@/db/queries/creative-status";
import { campaignStatusMap } from "@/db/queries/campaign-status";
import { resetAndSeed } from "./fixtures";

beforeEach(async () => {
  await resetAndSeed();
});

describe("status inputs are fetched once per request", () => {
  it("a second creativeStatusMap() call issues NO further queries", async () => {
    const spy = vi.spyOn(db, "select");
    const first = await creativeStatusMap();
    const afterFirst = spy.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0); // it did real work

    const second = await creativeStatusMap();
    expect(spy.mock.calls.length).toBe(afterFirst); // …and none the second time

    // Same answer, not a stale/empty one.
    expect([...second.keys()].sort()).toEqual([...first.keys()].sort());
    spy.mockRestore();
  });

  it("an id-restricted call reuses the shared scans and only narrows the result", async () => {
    const all = await creativeStatusMap();
    const someId = [...all.keys()][0]!;

    const spy = vi.spyOn(db, "select");
    const restricted = await creativeStatusMap([someId]);
    expect(spy.mock.calls.length).toBe(0); // restriction is a JS filter now
    spy.mockRestore();

    expect([...restricted.keys()]).toEqual([someId]);
    expect(restricted.get(someId)).toEqual(all.get(someId));
  });

  it("the breakdown adds only its own COUNT on top of the shared inputs", async () => {
    await creativeStatusMap(); // inputs already warm
    const spy = vi.spyOn(db, "select");
    await creativeStatusBreakdown();
    // Just the creatives COUNT(*) — the three status scans are not repeated.
    expect(spy.mock.calls.length).toBe(1);
    spy.mockRestore();
  });

  it("campaign status shares the platform-freshness scan with creative status", async () => {
    await creativeStatusMap(); // warms freshness via brandStatusInputs
    const spy = vi.spyOn(db, "select");
    await campaignStatusMap();
    // Only the per-campaign activity scan; freshness is already cached.
    expect(spy.mock.calls.length).toBe(1);
    spy.mockRestore();
  });
});
