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
import { listCreativeSummary } from "@/db/queries/summary";
import { resetAndSeed } from "./fixtures";

beforeAll(async () => {
  await resetAndSeed();
});
beforeEach(() => vi.mocked(getActiveAccountId).mockResolvedValue(ACCOUNT_A));

describe("listCreativeSummary()", () => {
  it("builds per-platform metric blocks + a blended total per creative", async () => {
    const res = await listCreativeSummary({
      platforms: ["instagram", "facebook"],
    });
    const c1 = res.rows.find((r) => r.name === "A-Creative-1");
    expect(c1).toBeDefined();
    expect(c1?.perPlatform.instagram?.spend).toBeCloseTo(200, 4);
    expect(c1?.perPlatform.facebook?.spend).toBeCloseTo(200, 4);
    // Blended total = weighted across the two selected platforms.
    expect(c1?.total.spend).toBeCloseTo(400, 4);
    expect(c1?.total.roas).toBeCloseTo(5, 4); // 2000 / 400
  });

  it("respects the type filter", async () => {
    const res = await listCreativeSummary({
      platforms: ["instagram", "facebook"],
      types: ["video"],
    });
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.rows.every((r) => r.type === "video")).toBe(true);
    expect(res.rows.some((r) => r.name === "A-Creative-1")).toBe(true);
  });
});
