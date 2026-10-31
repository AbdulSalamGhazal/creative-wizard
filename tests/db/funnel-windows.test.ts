import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

/**
 * The Funnel page compares the live window with the prior equal-length one.
 * Since 2026-11 (agent-04 perf pass) each pair is ONE scan: the overview's
 * totals group by window label, and the daily series is one GROUP BY date
 * split by date. What this pins: the same numbers as one query per window,
 * fewer reads, and the empty-window case.
 *
 * Fixture (account A): C1 · ig 2026-01-01 + 2026-01-02 (spend 100 each),
 * C1 · fb 2026-01-01 (spend 200), C2 · ig 2026-01-03 (EXCLUDED, spend 1000).
 * Range 2026-01-02 → 2026-01-03, so the prior window is 2026-01-01.
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
import { funnelDaily, funnelDailyWithPrevious, funnelOverview } from "@/db/queries/funnel";
import { resetAndSeed } from "./fixtures";

const RANGE = { from: "2026-01-02", to: "2026-01-03" };
const setAccount = (id: string) => vi.mocked(getActiveAccountId).mockResolvedValue(id);

beforeAll(async () => {
  await resetAndSeed();
});
beforeEach(() => setAccount(ACCOUNT_A));

describe("funnelOverview — both windows' totals in one scan", () => {
  it("current and previous are each window's own weighted totals", async () => {
    const o = await funnelOverview(RANGE);
    expect(o.current).toMatchObject({ spend: 100, impressions: 1000, clicks: 100, conversions: 10 });
    expect(o.current.ctr).toBeCloseTo(0.1, 6);
    expect(o.current.cpm).toBeCloseTo(100, 6);
    expect(o.previous).toMatchObject({ spend: 300, impressions: 3000, clicks: 200, conversions: 30 });
    expect(o.previous.ctr).toBeCloseTo(200 / 3000, 6); // SUM/SUM, not a mean of ratios
    expect(o.deltas.spend.pct).toBeCloseTo(-2 / 3, 6);
  });

  it("an empty window reads as zeros and nulls — the same as an empty aggregate", async () => {
    const o = await funnelOverview({ from: "2026-01-01", to: "2026-01-01" }); // prior window: 2025-12-31
    expect(o.current.spend).toBe(300);
    expect(o.previous).toMatchObject({ spend: 0, impressions: 0, clicks: 0, conversions: 0, ctr: null, cpm: null, cvr: null });
  });

  it("the excluded row joins its window when the toggle is on — and stays in the brand", async () => {
    const o = await funnelOverview({ ...RANGE, includeExcluded: true });
    expect(o.current.spend).toBe(1100); // + C2's excluded 1000 on 2026-01-03
    setAccount(ACCOUNT_B);
    const b = await funnelOverview({ from: "2026-01-01", to: "2026-01-01" });
    expect(b.current.spend).toBe(777);
  });

  it("is ONE select", async () => {
    const spy = vi.spyOn(db, "select");
    await funnelOverview(RANGE);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("funnelDailyWithPrevious — both windows' daily series in one scan", () => {
  it("equals funnelDaily over each window (live edge-filled, prior interior-only)", async () => {
    for (const f of [RANGE, { ...RANGE, includeExcluded: true }, { from: "2026-01-01", to: "2026-01-03" }]) {
      const pair = await funnelDailyWithPrevious(f);
      const current = await funnelDaily(f, { fillEdges: true });
      // prevPeriod: same length, ending the day before `from`.
      const days = (Date.parse(f.to) - Date.parse(f.from)) / 86_400_000 + 1;
      const prevTo = new Date(Date.parse(f.from) - 86_400_000).toISOString().slice(0, 10);
      const prevFrom = new Date(Date.parse(prevTo) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
      const previous = await funnelDaily({ ...f, from: prevFrom, to: prevTo });
      expect(pair.current).toEqual(current);
      expect(pair.previous).toEqual(previous);
    }
  });

  it("one daily scan for the pair (plus the live window's edge anchors)", async () => {
    const spy = vi.spyOn(db, "select");
    await funnelDailyWithPrevious(RANGE);
    // daily rows · the filter set's first day · the data horizon — two
    // single-window calls made four.
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });
});
