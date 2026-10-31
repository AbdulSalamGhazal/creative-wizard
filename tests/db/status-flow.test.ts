import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A } from "./config";

/**
 * The Dashboard's status flow reconstructs TWO past days — the day before the
 * range and its last day. Since 2026-11 (agent-04 perf pass) both days come
 * from ONE activity scan and ONE freshness scan (a FILTERed MAX per day), on
 * both branches: per platform, and per campaign when one platform is pinned.
 * This pins the transitions on a scenario where statuses MOVE between the two
 * days, and the number of reads.
 *
 * Fixture + this file's rows (window = 1 day):
 *   C1 · instagram · camp1   2026-01-01, 2026-01-02
 *   C1 · facebook  · camp2   2026-01-01
 *   C2 · instagram · camp1   2026-01-03 (EXCLUDED), 2026-01-04 (added here)
 *   C1 · tiktok    · camp1   2026-01-05 (added here)
 * Range 2026-01-02 → 2026-01-05, so the days are 2026-01-01 and 2026-01-05.
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
import { performanceRecords } from "@/db/schema";
import {
  creativeStatusMap,
  statusFlowBreakdown,
  type StatusFlowScope,
} from "@/db/queries/creative-status";
import { CAMPAIGN_1, CREATIVE_1, CREATIVE_2, resetAndSeed } from "./fixtures";

const BATCH_A = "55555555-5555-5555-5555-555555555001";
const RANGE = { from: "2026-01-02", to: "2026-01-05" };

const flowOf = (scopes: StatusFlowScope[], key: string) =>
  Object.fromEntries(
    (scopes.find((s) => s.key === key)?.data.transitions ?? []).map((t) => [
      `${t.from}→${t.to}`,
      t.count,
    ]),
  );

beforeAll(async () => {
  await resetAndSeed();
  const row = { accountId: ACCOUNT_A, impressions: 100, clicks: 10, conversions: 1, rawPayload: {}, uploadBatchId: BATCH_A };
  await db.insert(performanceRecords).values([
    { ...row, creativeId: CREATIVE_2, platform: "instagram", campaignId: CAMPAIGN_1, date: "2026-01-04", spend: "40" },
    { ...row, creativeId: CREATIVE_1, platform: "tiktok", campaignId: CAMPAIGN_1, date: "2026-01-05", spend: "50" },
  ]);
});
beforeEach(() => vi.mocked(getActiveAccountId).mockResolvedValue(ACCOUNT_A));

describe("statusFlowBreakdown — both days from one reconstruction pass", () => {
  it("per platform: the transitions each day's own status map implies", async () => {
    const scopes = await statusFlowBreakdown(RANGE, "platform");
    // instagram's freshness moves to 2026-01-04 (C2), so C1 (last 01-02) pauses.
    expect(flowOf(scopes, "instagram")).toEqual({ "active→pause": 1, "new→active": 1 });
    expect(flowOf(scopes, "facebook")).toEqual({ "active→active": 1 });
    expect(flowOf(scopes, "tiktok")).toEqual({ "new→active": 1 });

    // …which is exactly what the single-day reconstructions say.
    const start = await creativeStatusMap(undefined, { asOf: "2026-01-01" });
    const end = await creativeStatusMap(undefined, { asOf: "2026-01-05" });
    expect(start.get(CREATIVE_1)?.perPlatform).toMatchObject({ instagram: "active", facebook: "active" });
    expect(start.has(CREATIVE_2)).toBe(false);
    expect(end.get(CREATIVE_1)?.perPlatform).toMatchObject({
      instagram: "pause",
      facebook: "active",
      tiktok: "active",
    });
    expect(end.get(CREATIVE_2)?.perPlatform.instagram).toBe("active");
  });

  it("per platform: one activity + one freshness scan for the two days", async () => {
    const spy = vi.spyOn(db, "select");
    await statusFlowBreakdown(RANGE, "platform");
    // activity · freshness · the overrides read · the creatives count — the
    // two-scans-per-day version made seven.
    expect(spy).toHaveBeenCalledTimes(4);
    spy.mockRestore();
  });

  it("per campaign (one platform pinned): same reconstruction, two reads for the two days", async () => {
    const spy = vi.spyOn(db, "select");
    const scopes = await statusFlowBreakdown(RANGE, "campaign", "instagram");
    const reads = spy.mock.calls.length;
    spy.mockRestore();
    expect(scopes.map((s) => s.key)).toHaveLength(1);
    expect(flowOf(scopes, scopes[0]!.key)).toEqual({ "active→pause": 1, "new→active": 1 });
    // top campaigns · universe · anchors · last-spend — it was six.
    expect(reads).toBe(4);
  });
});
