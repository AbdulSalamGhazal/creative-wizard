import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A } from "./config";

/**
 * The creative detail page reads its creative's records ONCE (2026-11, agent-04
 * perf pass): the analytics body's per-platform first days and the danger
 * zone's deletion summary both derive from the request's `creativeRecordSpans`
 * — three reads of the same rows before (first days; per-platform counts;
 * distinct campaigns).
 *
 * React's `cache()` only dedupes inside a render, which vitest has none of, so
 * a per-args memo stands in for it — what this pins is the WIRING (both
 * consumers go through the one cached read), plus the values.
 */
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
      const memo = new Map<string, R>();
      return (...args: A): R => {
        const key = JSON.stringify(args);
        if (!memo.has(key)) memo.set(key, fn(...args));
        return memo.get(key) as R;
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
import { creativeDeletionSummary } from "@/db/queries/creatives";
import { creativePlatformFirstDays, creativeRecordSpans } from "@/db/queries/series-bounds";
import { CREATIVE_1, CREATIVE_2, CREATIVE_B, resetAndSeed } from "./fixtures";
import { getActiveAccountId } from "@/lib/tenant";

beforeAll(async () => {
  await resetAndSeed();
});
beforeEach(() => vi.mocked(getActiveAccountId).mockResolvedValue(ACCOUNT_A));

describe("creativeRecordSpans — one read for the detail page's two consumers", () => {
  it("first days and the deletion summary share ONE select", async () => {
    const spy = vi.spyOn(db, "select");
    const [first, summary] = await Promise.all([
      creativePlatformFirstDays(CREATIVE_1),
      creativeDeletionSummary(CREATIVE_1),
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();

    // C1: instagram 2026-01-01 + 2026-01-02, facebook 2026-01-01; two campaigns.
    expect(first).toEqual({ instagram: "2026-01-01", facebook: "2026-01-01" });
    expect(summary).toEqual({
      records: 3,
      platforms: [
        { platform: "instagram", records: 2 },
        { platform: "facebook", records: 1 },
      ],
      campaigns: 2,
      firstDate: "2026-01-01",
      lastDate: "2026-01-02",
    });
  });

  it("counts EXCLUDED records too — they are deleted with the creative", async () => {
    const s = await creativeDeletionSummary(CREATIVE_2);
    expect(s).toMatchObject({ records: 1, campaigns: 1, firstDate: "2026-01-03", lastDate: "2026-01-03" });
    expect(await creativePlatformFirstDays(CREATIVE_2)).toEqual({ instagram: "2026-01-03" });
  });

  it("another brand's creative reads as nothing (the account guard)", async () => {
    expect(await creativeRecordSpans(CREATIVE_B)).toEqual({ byPlatform: [], campaigns: 0 });
    expect(await creativeDeletionSummary(CREATIVE_B)).toEqual({
      records: 0,
      platforms: [],
      campaigns: 0,
      firstDate: null,
      lastDate: null,
    });
    expect(await creativePlatformFirstDays(CREATIVE_B)).toEqual({});
  });
});
