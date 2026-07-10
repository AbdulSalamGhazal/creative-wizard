import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A } from "./config";

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

import { getActiveAccountId } from "@/lib/tenant";
import { db } from "@/lib/db";
import { performanceRecords } from "@/db/schema";
import { creativeDailyMetrics } from "@/db/queries/performance";
import { funnelDaily } from "@/db/queries/funnel";
import {
  creativePlatformFirstDays,
  dataHorizon,
  platformHorizons,
  resolvePlatformBounds,
} from "@/db/queries/series-bounds";
import { resetAndSeed, CAMPAIGN_1, CAMPAIGN_2, CREATIVE_1, CREATIVE_2 } from "./fixtures";

// The regression this file pins: EDGE gaps. Interior fill (time-series-gaps
// .test.ts) only fills between a series' own first and last data day, so a
// currently-paused entity's line just ENDS — the ongoing pause is invisible —
// and a late-starting entity's line begins mid-window with no leading context.
// Edge fill draws trailing zeros up to the DATA HORIZON (a platform's own for a
// per-platform line; never past it) and leading zeros back to the window start
// for an entity that existed before it.

const BATCH_A = "55555555-5555-5555-5555-555555555001";
const day = (n: number) => `2026-03-${String(n).padStart(2, "0")}`;

function rec(
  creativeId: string,
  platform: "instagram" | "facebook" | "tiktok",
  campaignId: string,
  date: string,
  opts?: { spend?: number; excluded?: boolean },
) {
  return {
    accountId: ACCOUNT_A,
    creativeId,
    platform,
    date,
    campaignId,
    spend: String(opts?.spend ?? 50),
    impressions: 500,
    clicks: 25,
    conversions: 5,
    conversionValue: "250",
    landingPageViews: 100,
    excludedFromAggregates: opts?.excluded ?? false,
    rawPayload: {},
    uploadBatchId: BATCH_A,
  };
}

/**
 * Seed a March window on the fixture creatives (fixture data is all 2026-01, so
 * a 2026-03 request window isolates these rows):
 *  - CREATIVE_1 · instagram · 03-01..05  (last spend 10 days before its 03-15
 *    platform horizon → the trailing-edge case)
 *  - CREATIVE_2 · instagram · 03-15      (pushes the instagram horizon to 03-15)
 *  - CREATIVE_1 · facebook · 03-25       (late in-window; the creative existed
 *    pre-window via its 2026-01 fixture rows → the leading-edge case)
 *  - CREATIVE_2 · tiktok · 03-31 · EXCLUDED (sets the ACCOUNT data horizon to
 *    03-31 without touching instagram/facebook platform horizons, so funnel
 *    trails to 03-31 while the per-platform lines stop at their own horizons)
 */
async function seedEdgeRecords() {
  await db.insert(performanceRecords).values([
    rec(CREATIVE_1, "instagram", CAMPAIGN_1, day(1)),
    rec(CREATIVE_1, "instagram", CAMPAIGN_1, day(2)),
    rec(CREATIVE_1, "instagram", CAMPAIGN_1, day(3)),
    rec(CREATIVE_1, "instagram", CAMPAIGN_1, day(4)),
    rec(CREATIVE_1, "instagram", CAMPAIGN_1, day(5)),
    rec(CREATIVE_2, "instagram", CAMPAIGN_1, day(15)),
    rec(CREATIVE_1, "facebook", CAMPAIGN_2, day(25)),
    rec(CREATIVE_2, "tiktok", CAMPAIGN_1, day(31), { excluded: true }),
  ]);
}

const RANGE = { from: "2026-03-01", to: "2026-03-31" };

beforeAll(async () => {
  await resetAndSeed();
  await seedEdgeRecords();
});
beforeEach(() => vi.mocked(getActiveAccountId).mockResolvedValue(ACCOUNT_A));

describe("series-bounds — horizon / first-ever anchors", () => {
  it("dataHorizon includes excluded rows; platform horizons are per-platform", async () => {
    // The excluded tiktok 03-31 row IS the freshness horizon (data recency is
    // independent of exclusion), but instagram/facebook keep their own.
    expect(await dataHorizon()).toBe("2026-03-31");
    const ph = await platformHorizons();
    expect(ph.instagram).toBe("2026-03-15");
    expect(ph.facebook).toBe("2026-03-25");
    expect(ph.tiktok).toBe("2026-03-31");
  });

  it("creativePlatformFirstDays is unbounded by any window (sees the 2026-01 fixture)", async () => {
    const first = await creativePlatformFirstDays(CREATIVE_1);
    expect(first.instagram).toBe("2026-01-01");
    expect(first.facebook).toBe("2026-01-01");
  });
});

describe("creativeDailyMetrics — per-platform edge fill", () => {
  async function edgedRows() {
    const [pHorizons, pFirst] = await Promise.all([
      platformHorizons(),
      creativePlatformFirstDays(CREATIVE_1),
    ]);
    const edges = resolvePlatformBounds({
      from: RANGE.from,
      to: RANGE.to,
      firstDays: pFirst,
      horizons: pHorizons,
    });
    return creativeDailyMetrics({ creativeIds: [CREATIVE_1], ...RANGE }, edges);
  }

  it("trailing: instagram runs 03-01..03-15 (10 zero days), stops AT the horizon not the requested-to", async () => {
    const rows = (await edgedRows()).filter((r) => r.platform === "instagram");
    const dates = rows.map((r) => r.date);
    expect(dates[0]).toBe("2026-03-01");
    expect(dates[dates.length - 1]).toBe("2026-03-15"); // horizon, NOT 03-31
    expect(rows).toHaveLength(15);
    expect(dates.some((d) => d > "2026-03-15")).toBe(false);
    const byDate = new Map(rows.map((r) => [r.date, r]));
    for (let n = 6; n <= 15; n++) {
      const row = byDate.get(day(n))!;
      expect(row.spend).toBe(0);
      expect(row.roas).toBeNull();
      expect(row.ctr).toBeNull();
    }
    // A real day is untouched.
    expect(byDate.get("2026-03-03")!.spend).toBeCloseTo(50, 4);
  });

  it("leading: facebook fills zeros from the window start (03-01) because the creative existed before it", async () => {
    const rows = (await edgedRows()).filter((r) => r.platform === "facebook");
    const dates = rows.map((r) => r.date);
    expect(dates[0]).toBe("2026-03-01"); // window start, NOT 2026-01-01
    expect(dates[dates.length - 1]).toBe("2026-03-25");
    expect(dates.some((d) => d < "2026-03-01")).toBe(false);
    const byDate = new Map(rows.map((r) => [r.date, r]));
    for (let n = 1; n <= 24; n++) {
      const row = byDate.get(day(n))!;
      expect(row.spend).toBe(0);
      expect(row.ctr).toBeNull();
    }
    expect(byDate.get("2026-03-25")!.spend).toBeCloseTo(50, 4);
  });
});

describe("funnelDaily — edge fill (ratios break to null)", () => {
  it("trails to the account data horizon (03-31) with null rates, not past it", async () => {
    const rows = await funnelDaily(RANGE, { fillEdges: true });
    const dates = rows.map((r) => r.date);
    expect(dates[0]).toBe("2026-03-01");
    expect(dates[dates.length - 1]).toBe("2026-03-31"); // account horizon
    // Trailing days after the last real funnel day (03-25) break to null.
    const byDate = new Map(rows.map((r) => [r.date, r]));
    for (let n = 26; n <= 31; n++) {
      const row = byDate.get(day(n))!;
      expect(row.ctr).toBeNull();
      expect(row.cvr).toBeNull();
    }
    // A real funnel day keeps a defined rate.
    expect(byDate.get("2026-03-01")!.ctr).not.toBeNull();
  });

  it("without fillEdges, stops at the last real day (interior fill only)", async () => {
    const rows = await funnelDaily(RANGE);
    expect(rows[rows.length - 1]!.date).toBe("2026-03-25");
    expect(rows.some((r) => r.date > "2026-03-25")).toBe(false);
  });
});
