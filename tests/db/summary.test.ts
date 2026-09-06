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
import { db } from "@/lib/db";
import { creativeAngles, creatives } from "@/db/schema";
import { eq } from "drizzle-orm";
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

  it("respects the angles filter (regression: it used to ERROR, not filter)", async () => {
    // `= ANY(${array})` in a raw drizzle sql template expands to `ANY(($1,$2))`
    // — a row expression, not an array — so Postgres rejected the whole query
    // and the filter silently produced nothing. Pinning the working `IN` form.
    const [c1] = await db
      .select({ id: creatives.id })
      .from(creatives)
      .where(eq(creatives.name, "A-Creative-1"))
      .limit(1);
    await db
      .insert(creativeAngles)
      .values({ creativeId: c1!.id, angle: "ugc" })
      .onConflictDoNothing();

    // One angle (the case that raised "malformed array literal").
    const one = await listCreativeSummary({
      platforms: ["instagram", "facebook"],
      angles: ["ugc"],
    });
    expect(one.rows.map((r) => r.name)).toEqual(["A-Creative-1"]);

    // Two angles (the case that raised "op ANY/ALL requires array on right side").
    const two = await listCreativeSummary({
      platforms: ["instagram", "facebook"],
      angles: ["ugc", "does-not-exist"],
    });
    expect(two.rows.map((r) => r.name)).toEqual(["A-Creative-1"]);

    // A non-matching angle narrows to nothing rather than erroring.
    const none = await listCreativeSummary({
      platforms: ["instagram", "facebook"],
      angles: ["no-such-angle"],
    });
    expect(none.rows).toHaveLength(0);
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
