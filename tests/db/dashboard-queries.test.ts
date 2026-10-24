import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

import { getActiveAccountId } from "@/lib/tenant";
import { db } from "@/lib/db";
import { creativePlatformOverrides } from "@/db/schema";
import {
  creativeDimensionWindows,
  dashboardKpis,
  filteredPlatformFirstDays,
} from "@/db/queries/performance";
import {
  dataHorizon,
  earliestOf,
  latestOf,
  platformHorizons,
} from "@/db/queries/series-bounds";
import { creativeStatusMap } from "@/db/queries/creative-status";
import { CREATIVE_1, CREATIVE_2, CREATIVE_B, USER, resetAndSeed } from "./fixtures";

/**
 * W2-3 (2026-10): the Dashboard's rating windows went from FOUR scans to one
 * FILTER scan, its KPI pair from two fetches to one, and the as-of status
 * reconstruction stopped re-reading the overrides table. Each test pins that
 * the folded query returns what the separate ones did, on the shared fixture:
 *
 *   A · C1 · instagram  2026-01-01  spend 100  value 500
 *   A · C1 · instagram  2026-01-02  spend 100  value 500
 *   A · C1 · facebook   2026-01-01  spend 200  value 1000
 *   A · C2 · instagram  2026-01-03  spend 1000 value 9999  (EXCLUDED)
 *   B · CB · instagram  2026-01-01  spend 777  value 700
 */

const setAccount = (id: string) => vi.mocked(getActiveAccountId).mockResolvedValue(id);
const byBlock = (rows: Array<{ creativeId: string; key: string; spend: number; roas: number | null }>) =>
  Object.fromEntries(rows.map((r) => [`${r.creativeId}|${r.key}`, [r.spend, r.roas]]));

beforeAll(async () => {
  await resetAndSeed();
});
beforeEach(() => setAccount(ACCOUNT_A));

describe("creativeDimensionWindows — the rating windows in one scan", () => {
  const filters = { from: "2026-01-02", to: "2026-01-02" };

  it("the selected range is a component-sum block per (creative, platform)", async () => {
    const { selected } = await creativeDimensionWindows(filters, "platform", [1, 30, null]);
    expect(byBlock(selected)).toEqual({ [`${CREATIVE_1}|instagram`]: [100, 5] });
  });

  it("a lookback widens the START only (BETWEEN from − n AND to)", async () => {
    const { windows } = await creativeDimensionWindows(filters, "platform", [1, 30, null]);
    const widened = {
      [`${CREATIVE_1}|instagram`]: [200, 5],
      [`${CREATIVE_1}|facebook`]: [200, 5],
    };
    expect(byBlock(windows.get(1)!)).toEqual(widened);
    expect(byBlock(windows.get(30)!)).toEqual(widened);
  });

  it("lifetime has NO date bound — not even the range end — like the query it replaced", async () => {
    const { selected, windows } = await creativeDimensionWindows(
      { ...filters, includeExcluded: true },
      "platform",
      [null],
    );
    // C2's only row is 2026-01-03, after `to`: lifetime sees it, the range doesn't.
    const life = byBlock(windows.get(null)!);
    expect(life[`${CREATIVE_2}|instagram`]?.[0]).toBeCloseTo(1000, 4);
    expect(life[`${CREATIVE_2}|instagram`]?.[1]).toBeCloseTo(9.999, 4);
    expect(byBlock(selected)[`${CREATIVE_2}|instagram`]).toBeUndefined();
  });

  it("keeps the excluded rows out by default, and stays inside the active brand", async () => {
    const { windows } = await creativeDimensionWindows(filters, "platform", [null]);
    const ids = new Set(windows.get(null)!.map((r) => r.creativeId));
    expect(ids.has(CREATIVE_2)).toBe(false);
    expect(ids.has(CREATIVE_B)).toBe(false);
    setAccount(ACCOUNT_B);
    const b = await creativeDimensionWindows(filters, "platform", [null]);
    expect(byBlock(b.windows.get(null)!)).toEqual({ [`${CREATIVE_B}|instagram`]: [777, 700 / 777] });
  });

  it("groups by campaign NAME when a platform is pinned", async () => {
    const { windows } = await creativeDimensionWindows(
      { ...filters, platforms: ["facebook"] },
      "campaign",
      [30],
    );
    expect(byBlock(windows.get(30)!)).toEqual({
      [`${CREATIVE_1}|Camp Two ➤ Broad (FB)`]: [200, 5],
    });
  });
});

describe("the over-time bounds come from the per-platform reads", () => {
  it("the data horizon IS the latest platform horizon (excluded rows count in both)", async () => {
    expect(latestOf(await platformHorizons())).toBe(await dataHorizon());
    expect(await dataHorizon()).toBe("2026-01-03"); // the excluded C2 row
  });

  it("the filter set's first day IS the earliest per-platform first day", async () => {
    expect(earliestOf(await filteredPlatformFirstDays({}))).toBe("2026-01-01");
    // Excluded rows are out by default: C2 alone (only an excluded row) has none.
    expect(earliestOf(await filteredPlatformFirstDays({ creativeIds: [CREATIVE_2] }))).toBeNull();
    expect(
      earliestOf(await filteredPlatformFirstDays({ creativeIds: [CREATIVE_2], includeExcluded: true })),
    ).toBe("2026-01-03");
  });

  it("an empty map has no bound", () => {
    expect(earliestOf({})).toBeNull();
    expect(latestOf({})).toBeNull();
  });
});

describe("dashboardKpis — one KPI fetch for the tiles and the funnel card", () => {
  it("a bounded range gets the delta pair, and k IS its current window", async () => {
    const { k, kd } = await dashboardKpis({ from: "2026-01-02", to: "2026-01-02" });
    expect(kd).not.toBeNull();
    expect(k).toBe(kd!.current);
    expect(k.spend).toBeCloseTo(100, 4);
    expect(kd!.previous.spend).toBeCloseTo(300, 4); // 2026-01-01: 100 IG + 200 FB
  });

  it("an unbounded range gets plain totals and no delta", async () => {
    const { k, kd } = await dashboardKpis({});
    expect(kd).toBeNull();
    expect(k.spend).toBeCloseTo(400, 4);
  });
});

describe("as-of status reads terminations from the one cached overrides read", () => {
  beforeAll(async () => {
    await db.insert(creativePlatformOverrides).values({
      accountId: ACCOUNT_A,
      creativeId: CREATIVE_1,
      platform: "instagram",
      terminatedAt: new Date("2026-01-02T10:00:00Z"),
      terminatedByUserId: USER,
    });
  });
  afterAll(async () => {
    await db
      .delete(creativePlatformOverrides)
      .where(eq(creativePlatformOverrides.creativeId, CREATIVE_1));
  });

  it("a termination counts from its own day on — and not the day before", async () => {
    const before = await creativeStatusMap([CREATIVE_1], { asOf: "2026-01-01" });
    const on = await creativeStatusMap([CREATIVE_1], { asOf: "2026-01-02" });
    expect(before.get(CREATIVE_1)?.perPlatform.instagram).not.toBe("terminated");
    expect(on.get(CREATIVE_1)?.perPlatform.instagram).toBe("terminated");
  });
});
