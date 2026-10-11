import { beforeEach, describe, expect, it, vi } from "vitest";
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
import { creatives } from "@/db/schema";
import { campaignCreatives } from "@/db/queries/campaign";
import { CREATIVE_1, CREATIVE_2, resetAndSeed } from "./fixtures";

/**
 * THE CATALOG CHANGE (2026-10): the campaign-detail creatives table offers the
 * creative's own identity as opt-in columns, so the query now also returns the
 * product name, stages, priority and launch date. Two things have to stay
 * true: the identity is the creative's REAL identity, and the extra `products`
 * join did not quietly change which rows come back.
 */

const RANGE = { from: "2026-01-01", to: "2026-01-31" };
const CAMPAIGN = "Camp One ➤ Broad (IG)";

beforeEach(async () => {
  await resetAndSeed();
  vi.mocked(getActiveAccountId).mockResolvedValue(ACCOUNT_A);
});

describe("campaignCreatives — the identity it carries", () => {
  it("returns product, stages, priority and launch date for each creative", async () => {
    await db
      .update(creatives)
      .set({
        stages: ["Retargeting", "Awareness"],
        priority: 3,
        launchDate: "2026-01-01",
      })
      .where(eq(creatives.id, CREATIVE_1));

    const rows = await campaignCreatives(CAMPAIGN, RANGE, true);
    const one = rows.find((r) => r.name === "A-Creative-1")!;
    expect(one.productName).toBe("Product A");
    expect(one.stages).toEqual(["Retargeting", "Awareness"]);
    expect(one.priority).toBe(3);
    expect(one.launchDate).toBe("2026-01-01");
    expect(one.type).toBe("video");
    // Status is derived, not stored — it still arrives attached.
    expect(one.status).toBeTruthy();
  });

  it("leaves an undeclared identity EMPTY, never invented", async () => {
    // Unassigned stages are `[]` and an unrated priority is null — the two
    // "nobody has said yet" states the UI renders as an em-dash, not a zero.
    const rows = await campaignCreatives(CAMPAIGN, RANGE, true);
    const two = rows.find((r) => r.name === "A-Creative-2");
    if (two) {
      expect(two.stages).toEqual([]);
      expect(two.priority).toBeNull();
      expect(two.launchDate).toBeNull();
    }
    expect(rows.length).toBeGreaterThan(0);
  });

  it("the products join drops NO row — every creative that spent is still here", async () => {
    // `creatives.product_id` is NOT NULL, so the inner join cannot lose a row;
    // this pins that, because a join added for a COLUMN silently changing the
    // ROW SET is exactly the bug an opt-in column must not introduce.
    const withExcluded = await campaignCreatives(CAMPAIGN, RANGE, true);
    const names = withExcluded.map((r) => r.name).sort();
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("A-Creative-1");
    // …and every row's product resolves (no empty label slipped through).
    for (const r of withExcluded) expect(r.productName).toBeTruthy();
  });

  it("stays account-scoped", async () => {
    vi.mocked(getActiveAccountId).mockResolvedValue(ACCOUNT_B);
    const rows = await campaignCreatives(CAMPAIGN, RANGE, true);
    expect(rows).toEqual([]);
  });

  it("ignores a creative with no spend in the window", async () => {
    const narrow = await campaignCreatives(
      CAMPAIGN,
      { from: "2025-01-01", to: "2025-01-02" },
      true,
    );
    expect(narrow).toEqual([]);
    expect(CREATIVE_2).toBeTruthy();
  });
});
