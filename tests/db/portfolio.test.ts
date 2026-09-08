import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  // A 24h window: only the platform's own latest spend day counts as Active.
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

import { getActiveAccountId } from "@/lib/tenant";
import { portfolioCampaigns } from "@/db/queries/portfolio";
import { resetAndSeed } from "./fixtures";

const setAccount = (id: string) =>
  vi.mocked(getActiveAccountId).mockResolvedValue(id);

// The fixture window. IG's latest spend day is Jan 2 (Camp One), FB's is Jan 1
// (Camp Two) — each platform anchors to its OWN latest day, so both campaigns
// are Active despite falling on different dates.
const RANGE = { from: "2026-01-01", to: "2026-01-31" };

beforeEach(async () => {
  await resetAndSeed();
  setAccount(ACCOUNT_A);
});

describe("portfolioCampaigns — aggregates", () => {
  it("returns one row per campaign with weighted ratios", async () => {
    const rows = await portfolioCampaigns({ ...RANGE });
    const one = rows.find((r) => r.campaign.startsWith("Camp One"))!;
    const two = rows.find((r) => r.campaign.startsWith("Camp Two"))!;
    expect(one.spend).toBeCloseTo(200, 4); // IG 100 + 100
    expect(two.spend).toBeCloseTo(200, 4); // FB 200
    // CTR from component sums: 200 clicks / 2000 impressions.
    expect(one.ctr).toBeCloseTo(200 / 2000, 6);
  });

  it("excludes excluded rows by default", async () => {
    const hidden = await portfolioCampaigns({ ...RANGE });
    const withExcluded = await portfolioCampaigns({ ...RANGE, includeExcluded: true });
    const sum = (rs: Array<{ spend: number }>) => rs.reduce((s, r) => s + r.spend, 0);
    expect(sum(hidden)).toBeCloseTo(400, 4);
    // The 1000-spend excluded row sits on Camp One.
    expect(sum(withExcluded)).toBeCloseTo(1400, 4);
  });

  it("is account-scoped", async () => {
    setAccount(ACCOUNT_B);
    const rows = await portfolioCampaigns({ ...RANGE });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.spend).toBeCloseTo(777, 4);
  });
});

/**
 * Campaign status is DERIVED (no column), so it can't be a SQL WHERE — the
 * filter is applied in JS after the rows come back. These pin that seam: the
 * filter must narrow the SAME rows the unfiltered query returns, never re-query
 * differently or drop the aggregates.
 */
describe("portfolioCampaigns — derived-status post-filter", () => {
  it("every row carries a status, and the two fixture campaigns are Active", async () => {
    const rows = await portfolioCampaigns({ ...RANGE });
    expect(rows.length).toBe(2);
    // Each platform anchors to its own latest spend day, so Camp Two (FB, Jan 1)
    // is Active even though IG has a later day.
    expect(rows.every((r) => r.status === "active")).toBe(true);
  });

  it("filtering to 'active' keeps them; 'inactive' returns none", async () => {
    const all = await portfolioCampaigns({ ...RANGE });
    const active = await portfolioCampaigns({ ...RANGE, statuses: ["active"] });
    const inactive = await portfolioCampaigns({ ...RANGE, statuses: ["inactive"] });

    expect(active.map((r) => r.campaign).sort()).toEqual(
      all.map((r) => r.campaign).sort(),
    );
    expect(inactive).toHaveLength(0);
    // The post-filter narrows rows; it must not alter the aggregates on them.
    expect(active.find((r) => r.campaign.startsWith("Camp One"))!.spend).toBeCloseTo(
      200,
      4,
    );
  });

  it("both statuses selected is the same as no status filter", async () => {
    const all = await portfolioCampaigns({ ...RANGE });
    const both = await portfolioCampaigns({
      ...RANGE,
      statuses: ["active", "inactive"],
    });
    expect(both.map((r) => r.campaignId).sort()).toEqual(
      all.map((r) => r.campaignId).sort(),
    );
  });

  it("the objective and search filters still run in SQL alongside it", async () => {
    const sales = await portfolioCampaigns({ ...RANGE, objectives: ["Sales"] });
    expect(sales).toHaveLength(2); // both fixtures are Sales
    const searched = await portfolioCampaigns({ ...RANGE, q: "camp one" });
    expect(searched).toHaveLength(1);
    expect(searched[0]!.campaign).toContain("Camp One");
  });
});
