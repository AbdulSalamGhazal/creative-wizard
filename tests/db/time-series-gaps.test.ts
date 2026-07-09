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
import { campaignDaily } from "@/db/queries/campaign";
import { resetAndSeed, CAMPAIGN_1, CREATIVE_1 } from "./fixtures";

// The regression this file pins: daily-series queries GROUP BY date and used
// to return only dates WITH rows, so a mid-window pause was silently skipped
// by every chart. fillDailyGaps must insert the interior days (additive 0,
// ratio null) — and must NOT invent days outside the campaign's data span.

const CAMPAIGN_NAME = "Camp One ➤ Broad (IG)";

/** Seed gappy spend onto the fixture campaign: 2026-03-01..05 and 2026-03-20..25. */
async function seedGappyRecords() {
  const day = (n: number) => `2026-03-${String(n).padStart(2, "0")}`;
  const days = [1, 2, 3, 4, 5, 20, 21, 22, 23, 24, 25].map(day);
  await db.insert(performanceRecords).values(
    days.map((date) => ({
      accountId: ACCOUNT_A,
      creativeId: CREATIVE_1,
      platform: "instagram" as const,
      date,
      campaignId: CAMPAIGN_1,
      spend: "50",
      impressions: 500,
      clicks: 25,
      conversions: 5,
      conversionValue: "250",
      landingPageViews: 100,
      rawPayload: {},
      // Fixture batch id from fixtures.ts (BATCH_A) — re-declared here to keep
      // the helper self-contained.
      uploadBatchId: "55555555-5555-5555-5555-555555555001",
    })),
  );
}

beforeAll(async () => {
  await resetAndSeed();
  await seedGappyRecords();
});
beforeEach(() => vi.mocked(getActiveAccountId).mockResolvedValue(ACCOUNT_A));

describe("campaignDaily — interior gap filling", () => {
  it("returns every calendar day of the data span, zero-filling the pause", async () => {
    const rows = await campaignDaily(CAMPAIGN_NAME, {
      from: "2026-03-01",
      to: "2026-03-31",
    });
    // Span is 03-01 → 03-25: 25 calendar days, no more, no less.
    expect(rows).toHaveLength(25);
    expect(rows[0]!.date).toBe("2026-03-01");
    expect(rows[rows.length - 1]!.date).toBe("2026-03-25");
    // No invented days after the last data day (03-26..31 absent).
    expect(rows.some((r) => r.date > "2026-03-25")).toBe(false);
  });

  it("filled days 06–19 carry spend 0 and ctr null; real days keep their values", async () => {
    const rows = await campaignDaily(CAMPAIGN_NAME, {
      from: "2026-03-01",
      to: "2026-03-31",
    });
    const byDate = new Map(rows.map((r) => [r.date, r]));
    for (let n = 6; n <= 19; n++) {
      const d = `2026-03-${String(n).padStart(2, "0")}`;
      const row = byDate.get(d);
      expect(row, `missing filled day ${d}`).toBeDefined();
      expect(row!.spend).toBe(0);
      expect(row!.impressions).toBe(0);
      expect(row!.conversions).toBe(0);
      expect(row!.ctr).toBeNull();
      expect(row!.roas).toBeNull();
      expect(row!.cpm).toBeNull();
    }
    // A real day is untouched.
    const real = byDate.get("2026-03-03")!;
    expect(real.spend).toBeCloseTo(50, 4);
    expect(real.ctr).toBeCloseTo(25 / 500, 6);
  });
});
