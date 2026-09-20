import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A } from "./config";

const USER = "11111111-1111-1111-1111-111111111111"; // seeded by the fixtures

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

// Only the auth boundary is faked — the guards under test run for real.
vi.mock("@/lib/auth", () => ({
  requirePermission: vi.fn(async () => ({ id: USER, role: "admin" })),
  auth: vi.fn(async () => ({ id: USER, role: "admin" })),
  can: vi.fn(() => true),
}));

import { getActiveAccountId } from "@/lib/tenant";
import { db } from "@/lib/db";
import { campaigns, performanceRecords, uploadBatches } from "@/db/schema";
import { campaignFunnel, funnelOverview } from "@/db/queries/funnel";
import { kpis, compareDimensions } from "@/db/queries/performance";
import { listCreativeSummary } from "@/db/queries/summary";
import { resetAndSeed, CREATIVE_1, CREATIVE_2 } from "./fixtures";

const setAccount = (id: string) => vi.mocked(getActiveAccountId).mockResolvedValue(id);

const GOOGLE_CAMPAIGN = "44444444-4444-4444-4444-44444444a0f1";
const GOOGLE_BATCH = "55555555-5555-5555-5555-55555555a0f1";
/**
 * The creative a google upload names. It is an ORDINARY creative the team
 * created (2026-09-20 — google is the standard pipeline now); this one
 * happens to have run on google and nowhere else.
 */
const GOOGLE_ONLY_CREATIVE = CREATIVE_2;

beforeAll(async () => {
  await resetAndSeed();
});
beforeEach(() => setAccount(ACCOUNT_A));

/**
 * THE RATIO-POISONING TRAP, against the real queries.
 *
 * Google reports conversions but has no add-payment events at all. Two layers
 * protect the numbers, and both are pinned below:
 *   - phase 1, the SQL guard: on a BRAND-level query (kpis), google's rows are
 *     counted in the totals but excluded from BOTH sides of any rate it can't
 *     report;
 *   - phase 2, the surface rule: on the FUNNEL surfaces google isn't there at
 *     all, so its spend and conversions don't appear either.
 */
describe("blended funnel rates with google in the data", () => {
  const FROM = "2026-03-01";
  const TO = "2026-03-31";

  beforeAll(async () => {
    await db.insert(campaigns).values({
      id: GOOGLE_CAMPAIGN,
      accountId: ACCOUNT_A,
      name: "Search Brand ➤ All",
      platform: "google",
      objective: "Sales",
      createdByUserId: USER,
    });
    await db.insert(uploadBatches).values({
      id: GOOGLE_BATCH,
      accountId: ACCOUNT_A,
      platform: "google",
      fileName: "g.csv",
      uploadedByUserId: USER,
      rowsImported: 2,
    });
    await db.insert(performanceRecords).values([
      // instagram: a full funnel — 100 LP views → 50 ATC → 40 AP → 10 purchases.
      {
        accountId: ACCOUNT_A,
        creativeId: CREATIVE_1,
        platform: "instagram",
        date: "2026-03-10",
        campaignId: GOOGLE_CAMPAIGN,
        spend: "100",
        impressions: 1000,
        clicks: 200,
        conversions: 10,
        conversionValue: "500",
        landingPageViews: 100,
        addToCart: 50,
        addPayment: 40,
        rawPayload: {},
        uploadBatchId: GOOGLE_BATCH,
      },
      // google: conversions only — the mid-funnel columns are NULL, because
      // google never reported them (the pipeline refuses to write 0 there).
      {
        accountId: ACCOUNT_A,
        creativeId: GOOGLE_ONLY_CREATIVE,
        platform: "google",
        date: "2026-03-10",
        campaignId: GOOGLE_CAMPAIGN,
        spend: "200",
        impressions: 5000,
        clicks: 300,
        conversions: 90,
        conversionValue: "4500",
        landingPageViews: null,
        addToCart: null,
        addPayment: null,
        rawPayload: {},
        uploadBatchId: GOOGLE_BATCH,
      },
    ]);
  });

  // ---- phase 1: the SQL guard, on a brand-level query that KEEPS google ----
  it("brand-level rates exclude google from both sides, totals keep it", async () => {
    const k = await kpis({ from: FROM, to: TO });
    // Totals: google's spend and conversions are real brand numbers.
    expect(k.spend).toBe(300); // 100 + 200
    expect(k.impressions).toBe(6000);
    expect(k.clicks).toBe(500);
    expect(k.conversions).toBe(100); // 10 + 90
    // Ratios google fully reports keep it in.
    expect(k.ctr).toBeCloseTo(500 / 6000, 9);
    expect(k.cpm).toBeCloseTo((300 / 6000) * 1000, 9);
    // Ratios it can't back are instagram's own — NOT the poisoned blend.
    expect(k.cvr).toBeCloseTo(10 / 100, 9); // NOT (10+90)/100
    expect(k.voc).toBeCloseTo(100 / 200, 9); // NOT 100/(200+300)
  });

  it("the funnel card's CPM/CTR are the google-free pair", async () => {
    const k = await kpis({ from: FROM, to: TO });
    // The card must tell ONE story, so its CPM/CTR drop google too — unlike
    // the brand-level cpm/ctr above, which are every platform's.
    expect(k.funnelCtr).toBeCloseTo(200 / 1000, 9);
    expect(k.funnelCpm).toBeCloseTo((100 / 1000) * 1000, 9);
    expect(k.funnelCtr).not.toBeCloseTo(k.ctr!, 6);
  });

  // ---- phase 2: the funnel surfaces don't show google at all ----
  it("/funnel excludes google ENTIRELY — its conversions never reach CvR", async () => {
    const { current } = await funnelOverview({ from: FROM, to: TO });
    // Instagram's row and nothing else.
    expect(current.spend).toBe(100);
    expect(current.impressions).toBe(1000);
    expect(current.clicks).toBe(200);
    expect(current.conversions).toBe(10); // NOT 100 — google's 90 are not here
    expect(current.ctr).toBeCloseTo(200 / 1000, 9);
  });

  it("every funnel rate is instagram's own", async () => {
    const { current } = await funnelOverview({ from: FROM, to: TO });
    expect(current.purchaseRate).toBeCloseTo(10 / 40, 9);
    // The bug both layers guard against: (10 + 90) / 40 = 250%, a rate that
    // claims more purchases than there were add-payments.
    expect(current.purchaseRate).not.toBeCloseTo(2.5, 6);
    expect(current.cvr).toBeCloseTo(10 / 100, 9);
    expect(current.voc).toBeCloseTo(100 / 200, 9);
    expect(current.atcRate).toBeCloseTo(50 / 100, 9);
    expect(current.apRate).toBeCloseTo(40 / 50, 9);
  });

  it("the per-campaign funnel table gets no Google row", async () => {
    const rows = await campaignFunnel({ from: FROM, to: TO });
    expect(rows.some((r) => r.platform === "google")).toBe(false);
    expect(rows).toHaveLength(1);
  });

  it("a forged ?platforms=google on /funnel yields nothing, not google", async () => {
    const { current } = await funnelOverview({
      from: FROM,
      to: TO,
      platforms: ["google"],
    });
    expect(current.spend).toBe(0);
    expect(current.conversions).toBe(0);
    expect(current.cvr).toBeNull();
  });
});

/**
 * The PLATFORM-level rule (unchanged), now that the creative-level one is
 * gone. Google's creatives are ordinary creatives and appear wherever
 * creatives appear; what stays out is google's DATA, on the surfaces that
 * compare platforms using metrics google doesn't report.
 */
describe("creative-level surfaces: the creative is ordinary, the DATA stays out", () => {
  const FROM = "2026-03-01";
  const TO = "2026-03-31";

  it("Ads LISTS a google-only creative — as an all-dash row, like any creative that never ran there", async () => {
    const all = await listCreativeSummary({ from: FROM, to: TO });
    const row = all.rows.find((r) => r.creativeId === GOOGLE_ONLY_CREATIVE);
    expect(row).toBeDefined();
    // Every platform block it could have is empty, and so is the blended
    // total: its only spend is google's, and google has no column group here.
    for (const platform of all.platforms) {
      expect(row!.perPlatform[platform]?.spend ?? null).toBeNull();
    }
  });

  it("…and still never builds a Google column group, even if one is asked for", async () => {
    const asked = await listCreativeSummary({
      from: FROM,
      to: TO,
      platforms: ["google", "instagram"],
    });
    expect(asked.platforms).toEqual(["instagram"]);
    const onlyGoogle = await listCreativeSummary({
      from: FROM,
      to: TO,
      platforms: ["google"],
    });
    expect(onlyGoogle.platforms).toEqual([]);
  });

  it("Compare's picker still offers no google platform or campaign", async () => {
    const dims = await compareDimensions();
    expect(dims.some((d) => d.platform === "google")).toBe(false);
    // A creative whose ONLY rows are google's has nothing to compare here, so
    // it isn't offered — not because of what it IS, but because of where its
    // data is. A creative with rows on both would appear, for the other ones.
    expect(dims.some((d) => d.creativeId === GOOGLE_ONLY_CREATIVE)).toBe(false);
  });
});
