import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

/**
 * Compare's daily series: ONE scan per side carries every metric block
 * (2026-11, agent-04 perf pass). What this pins:
 *  · a metric's series is identical whether it is asked for alone or beside
 *    every other metric — the multi-column query changes the query COUNT,
 *    never a number;
 *  · a side costs exactly one `select`, however many blocks are open;
 *  · the usual invariants still hold — weighted ratios, the excluded filter
 *    and its toggle, tenancy.
 */
vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

import { getActiveAccountId } from "@/lib/tenant";
import { db } from "@/lib/db";
import { compareSideSeries } from "@/db/queries/performance";
import { COMPARE_METRICS } from "@/validators/compare";
import { resetAndSeed } from "./fixtures";

const setAccount = (id: string) =>
  vi.mocked(getActiveAccountId).mockResolvedValue(id);

const RANGE = { from: "2026-01-01", to: "2026-01-03" };

beforeAll(async () => {
  await resetAndSeed();
});
beforeEach(() => setAccount(ACCOUNT_A));

describe("compareSideSeries — every metric in one scan", () => {
  it("each metric's series equals the same metric asked for alone", async () => {
    const all = await compareSideSeries({ ...RANGE, metrics: COMPARE_METRICS });
    expect([...all.keys()]).toEqual([...COMPARE_METRICS]);
    for (const m of COMPARE_METRICS) {
      const alone = await compareSideSeries({ ...RANGE, metrics: [m] });
      expect(all.get(m)).toEqual(alone.get(m));
    }
  });

  it("issues ONE select per side, however many metrics", async () => {
    const spy = vi.spyOn(db, "select");
    await compareSideSeries({ ...RANGE, metrics: COMPARE_METRICS });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("no metrics → no query, empty map", async () => {
    const spy = vi.spyOn(db, "select");
    const out = await compareSideSeries({ ...RANGE, metrics: [] });
    expect(out.size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("sums per day and weights ratios via component sums", async () => {
    const s = await compareSideSeries({ ...RANGE, metrics: ["spend", "ctr", "cpa"] });
    // 2026-01-03 holds only the excluded row — hidden by default.
    expect(s.get("spend")).toEqual([
      { date: "2026-01-01", value: 300 }, // ig 100 + fb 200
      { date: "2026-01-02", value: 100 },
    ]);
    const ctr = s.get("ctr")!;
    expect(ctr[0]!.value).toBeCloseTo(200 / 3000, 6); // SUM(clicks)/SUM(impr), not a mean
    expect(s.get("cpa")![0]!.value).toBeCloseTo(300 / 30, 6);
  });

  it("includeExcluded folds the excluded day back in", async () => {
    const s = await compareSideSeries({ ...RANGE, includeExcluded: true, metrics: ["spend"] });
    expect(s.get("spend")?.map((p) => p.date)).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
    ]);
    expect(s.get("spend")?.[2]?.value).toBe(1000);
  });

  it("scopes to the side's platform and to the active brand", async () => {
    const ig = await compareSideSeries({ ...RANGE, platforms: ["instagram"], metrics: ["spend"] });
    expect(ig.get("spend")?.[0]).toEqual({ date: "2026-01-01", value: 100 });

    setAccount(ACCOUNT_B);
    const b = await compareSideSeries({ ...RANGE, metrics: ["spend"] });
    expect(b.get("spend")).toEqual([{ date: "2026-01-01", value: 777 }]);
  });
});
