import { beforeEach, describe, expect, it, vi } from "vitest";
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
import { creativeAngles, performanceRecords } from "@/db/schema";
import {
  angleRollup,
  angleByPlatform,
  typeRollup,
  videoDiagnostics,
} from "@/db/queries/trends";
import {
  resetAndSeed,
  CREATIVE_1,
  CREATIVE_2,
  CREATIVE_B,
  CAMPAIGN_1,
} from "./fixtures";

const BATCH_A = "55555555-5555-5555-5555-555555555001";

const setAccount = (id: string) =>
  vi.mocked(getActiveAccountId).mockResolvedValue(id);

// Fixture totals for account A, non-excluded: IG 100 + 100, FB 200 = 400 spend,
// 4000 impressions, 300 clicks, 40 conversions, 2000 revenue. The 1000-spend
// row on CREATIVE_2 is excluded_from_aggregates.
const A_SPEND = 400;
const A_IMPRESSIONS = 4000;
const A_CLICKS = 300;
const A_CONVERSIONS = 40;

beforeEach(async () => {
  await resetAndSeed();
  setAccount(ACCOUNT_A);
  // Angles are assignments by string; give each brand's creatives one.
  await db.insert(creativeAngles).values([
    { creativeId: CREATIVE_1, angle: "ugc" },
    { creativeId: CREATIVE_2, angle: "ugc" },
    { creativeId: CREATIVE_B, angle: "ugc" },
  ]);
});

describe("trends — angle rollup", () => {
  it("blends ratios from component SUMS, not by averaging ratios", async () => {
    const rows = await angleRollup({});
    const ugc = rows.find((r) => r.angle === "ugc")!;
    expect(ugc.spend).toBeCloseTo(A_SPEND, 4);
    expect(ugc.impressions).toBe(A_IMPRESSIONS);
    // CTR = SUM(clicks)/SUM(impressions) = 300/4000, NOT the mean of the
    // per-row CTRs (which would be (0.1+0.1+0.05)/3 ≈ 0.0833).
    expect(ugc.ctr).toBeCloseTo(A_CLICKS / A_IMPRESSIONS, 6);
    expect(ugc.ctr).not.toBeCloseTo(0.0833, 3);
    // CPA = spend / conversions.
    expect(ugc.cpa).toBeCloseTo(A_SPEND / A_CONVERSIONS, 6);
    // CPM = spend / impressions * 1000.
    expect(ugc.cpm).toBeCloseTo((A_SPEND / A_IMPRESSIONS) * 1000, 6);
  });

  it("excludes excluded rows by default and counts them on request", async () => {
    const [hidden] = await angleRollup({});
    expect(hidden!.spend).toBeCloseTo(A_SPEND, 4);
    const [shown] = await angleRollup({ includeExcluded: true });
    expect(shown!.spend).toBeCloseTo(A_SPEND + 1000, 4);
  });

  it("is account-scoped — B's 777 never reaches A", async () => {
    const a = await angleRollup({});
    expect(a[0]!.spend).toBeCloseTo(A_SPEND, 4);
    setAccount(ACCOUNT_B);
    const b = await angleRollup({});
    expect(b[0]!.spend).toBeCloseTo(777, 4);
  });

  it("a bounded range compares against the PRIOR window of equal length", async () => {
    // Seed the two days immediately before Jan 3–4 so there is something to
    // compare to; without prior-window rows `prev` is legitimately null.
    await db.insert(performanceRecords).values([
      {
        accountId: ACCOUNT_A,
        creativeId: CREATIVE_1,
        platform: "instagram",
        campaignId: CAMPAIGN_1,
        date: "2026-01-04",
        spend: "50.0000",
        impressions: 500,
        clicks: 25,
        conversions: 5,
        conversionValue: "250.0000",
        rawPayload: {},
        uploadBatchId: BATCH_A,
      },
    ]);

    const unbounded = await angleRollup({});
    expect(unbounded[0]!.prev).toBeNull(); // nothing to compare an open range to

    // Jan 3–4 (2 days) compares against Jan 1–2 (the prior 2 days).
    const bounded = await angleRollup({ from: "2026-01-03", to: "2026-01-04" });
    const ugc = bounded.find((r) => r.angle === "ugc")!;
    expect(ugc.spend).toBeCloseTo(50, 4); // the excluded Jan 3 row doesn't count
    expect(ugc.prev).not.toBeNull();
    expect(ugc.prev!.spend).toBeCloseTo(A_SPEND, 4); // all of Jan 1–2
  });

  it("the date filter actually bounds the window", async () => {
    const janFirst = await angleRollup({ from: "2026-01-01", to: "2026-01-01" });
    expect(janFirst[0]!.spend).toBeCloseTo(300, 4); // IG 100 + FB 200
  });
});

describe("trends — angle × platform", () => {
  it("splits the same totals per platform, and they re-sum", async () => {
    const rows = await angleByPlatform({});
    const ig = rows.find((r) => r.platform === "instagram" && r.angle === "ugc")!;
    const fb = rows.find((r) => r.platform === "facebook" && r.angle === "ugc")!;
    expect(ig.spend).toBeCloseTo(200, 4);
    expect(fb.spend).toBeCloseTo(200, 4);
    expect(ig.spend + fb.spend).toBeCloseTo(A_SPEND, 4);
    // Per-platform ratios are weighted within that platform.
    expect(ig.ctr).toBeCloseTo(200 / 2000, 6);
  });

  it("respects the platform filter and account scoping", async () => {
    const only = await angleByPlatform({ platforms: ["facebook"] });
    expect(only.every((r) => r.platform === "facebook")).toBe(true);
    setAccount(ACCOUNT_B);
    const b = await angleByPlatform({});
    expect(b.reduce((s, r) => s + r.spend, 0)).toBeCloseTo(777, 4);
  });
});

describe("trends — type rollup", () => {
  it("buckets by creative type with weighted ratios", async () => {
    const rows = await typeRollup({});
    const video = rows.find((r) => r.type === "video")!;
    // Only CREATIVE_1 (video) has non-excluded spend.
    expect(video.spend).toBeCloseTo(A_SPEND, 4);
    expect(video.ctr).toBeCloseTo(A_CLICKS / A_IMPRESSIONS, 6);
    // The image creative's only row is excluded, so it contributes nothing.
    const image = rows.find((r) => r.type === "image");
    expect(image?.spend ?? 0).toBeCloseTo(0, 4);
  });

  it("counts the excluded image row when asked", async () => {
    const rows = await typeRollup({ includeExcluded: true });
    expect(rows.find((r) => r.type === "image")!.spend).toBeCloseTo(1000, 4);
  });

  it("is account-scoped", async () => {
    setAccount(ACCOUNT_B);
    const rows = await typeRollup({});
    expect(rows.reduce((s, r) => s + r.spend, 0)).toBeCloseTo(777, 4);
  });
});

describe("trends — video diagnostics", () => {
  it("covers only video creatives and stays account-scoped", async () => {
    const res = await videoDiagnostics({});
    // CREATIVE_1 is the only video with non-excluded spend in account A.
    expect(res.rows.every((r) => r.name !== "A-Creative-2")).toBe(true);
    setAccount(ACCOUNT_B);
    const b = await videoDiagnostics({});
    expect(b.rows.every((r) => r.name !== "A-Creative-1")).toBe(true);
  });
});
