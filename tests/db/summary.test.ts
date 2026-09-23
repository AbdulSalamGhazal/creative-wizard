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

  it("Ads: the stage filter tells N/A apart from Unassigned", async () => {
    const [c1] = await db
      .select({ id: creatives.id })
      .from(creatives)
      .where(eq(creatives.name, "A-Creative-1"));
    await db.update(creatives).set({ stages: ["N/A"] }).where(eq(creatives.id, c1!.id));

    const na = await listCreativeSummary({ platforms: ["instagram"], stages: ["N/A"] });
    expect(na.rows.map((r) => r.name)).toEqual(["A-Creative-1"]);

    // The other fixture creative has no stages — Unassigned, never N/A.
    const unassigned = await listCreativeSummary({
      platforms: ["instagram"],
      stages: ["unassigned"],
    });
    expect(unassigned.rows.map((r) => r.name)).not.toContain("A-Creative-1");

    const funnel = await listCreativeSummary({ platforms: ["instagram"], stages: ["Awareness"] });
    expect(funnel.rows.map((r) => r.name)).not.toContain("A-Creative-1");

    // Put it back — this suite shares one seeded database.
    await db.update(creatives).set({ stages: [] }).where(eq(creatives.id, c1!.id));
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

describe("Ads Priority — a per-creative column, sorted and filtered", () => {
  beforeEach(async () => {
    await resetAndSeed();
    vi.mocked(getActiveAccountId).mockResolvedValue(ACCOUNT_A);
    await db.update(creatives).set({ priority: 2 }).where(eq(creatives.name, "A-Creative-1"));
    await db.update(creatives).set({ priority: null }).where(eq(creatives.name, "A-Creative-2"));
  });

  it("carries priority on every row", async () => {
    const res = await listCreativeSummary({ platforms: ["instagram", "facebook"] });
    expect(res.rows.find((r) => r.name === "A-Creative-1")?.priority).toBe(2);
    expect(res.rows.find((r) => r.name === "A-Creative-2")?.priority).toBeNull();
  });

  it("sorts unrated LAST in BOTH directions", async () => {
    const desc = await listCreativeSummary({
      platforms: ["instagram", "facebook"],
      sort: "priority",
      dir: "desc",
    });
    expect(desc.rows.map((r) => r.priority)).toEqual([2, null]);
    expect(desc.effectiveSort).toEqual({ key: "priority", dir: "desc" });

    const asc = await listCreativeSummary({
      platforms: ["instagram", "facebook"],
      sort: "priority",
      dir: "asc",
    });
    expect(asc.rows.map((r) => r.priority)).toEqual([2, null]);
  });

  it("filters by value and by Unrated", async () => {
    const rated = await listCreativeSummary({
      platforms: ["instagram", "facebook"],
      priorities: ["2"],
    });
    expect(rated.rows.map((r) => r.name)).toEqual(["A-Creative-1"]);

    const unrated = await listCreativeSummary({
      platforms: ["instagram", "facebook"],
      priorities: ["unrated"],
    });
    expect(unrated.rows.map((r) => r.name)).toEqual(["A-Creative-2"]);

    // ANDs with the other filters like any plain dimension.
    const withType = await listCreativeSummary({
      platforms: ["instagram", "facebook"],
      priorities: ["2"],
      types: ["image"],
    });
    expect(withType.rows).toHaveLength(0);
  });
});

describe("Ads Stage — a per-creative column, sorted and filtered", () => {
  beforeEach(async () => {
    await resetAndSeed();
    vi.mocked(getActiveAccountId).mockResolvedValue(ACCOUNT_A);
    await db
      .update(creatives)
      .set({ stages: ["Retargeting", "Awareness"] })
      .where(eq(creatives.name, "A-Creative-1"));
    await db.update(creatives).set({ stages: [] }).where(eq(creatives.name, "A-Creative-2"));
  });

  it("carries stages in funnel order on every row", async () => {
    const res = await listCreativeSummary({ platforms: ["instagram", "facebook"] });
    expect(res.rows.find((r) => r.name === "A-Creative-1")?.stages).toEqual([
      "Awareness",
      "Retargeting",
    ]);
    expect(res.rows.find((r) => r.name === "A-Creative-2")?.stages).toEqual([]);
  });

  it("sorts by the earliest stage, unassigned LAST in both directions", async () => {
    const desc = await listCreativeSummary({
      platforms: ["instagram", "facebook"],
      sort: "stage",
      dir: "desc",
    });
    expect(desc.rows.map((r) => r.name)).toEqual(["A-Creative-1", "A-Creative-2"]);
    expect(desc.effectiveSort).toEqual({ key: "stage", dir: "desc" });

    const asc = await listCreativeSummary({
      platforms: ["instagram", "facebook"],
      sort: "stage",
      dir: "asc",
    });
    expect(asc.rows.map((r) => r.name)).toEqual(["A-Creative-1", "A-Creative-2"]);
  });

  it("filters on OVERLAP, and on Unassigned", async () => {
    const awareness = await listCreativeSummary({
      platforms: ["instagram", "facebook"],
      stages: ["Awareness"],
    });
    expect(awareness.rows.map((r) => r.name)).toEqual(["A-Creative-1"]);

    const unassigned = await listCreativeSummary({
      platforms: ["instagram", "facebook"],
      stages: ["unassigned"],
    });
    expect(unassigned.rows.map((r) => r.name)).toEqual(["A-Creative-2"]);

    // ANDs with the other filters like any plain dimension.
    const withType = await listCreativeSummary({
      platforms: ["instagram", "facebook"],
      stages: ["Awareness"],
      types: ["image"],
    });
    expect(withType.rows).toHaveLength(0);
  });
});
