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
import { creativeDeletionSummary, listCreatives } from "@/db/queries/creatives";
import { db } from "@/lib/db";
import { creatives } from "@/db/schema";
import { eq } from "drizzle-orm";
import { resetAndSeed, CREATIVE_1, CREATIVE_2, CREATIVE_B } from "./fixtures";

const setAccount = (id: string) =>
  vi.mocked(getActiveAccountId).mockResolvedValue(id);

beforeAll(async () => {
  await resetAndSeed();
});
beforeEach(() => setAccount(ACCOUNT_A));

describe("creativeDeletionSummary()", () => {
  it("counts every record + campaign that would be deleted with the creative", async () => {
    const s = await creativeDeletionSummary(CREATIVE_1);
    expect(s.records).toBe(3); // 2 instagram + 1 facebook
    expect(s.campaigns).toBe(2); // camp1, camp2
    expect(s.platforms.find((p) => p.platform === "instagram")?.records).toBe(2);
    expect(s.platforms.find((p) => p.platform === "facebook")?.records).toBe(1);
    expect(s.firstDate).toBe("2026-01-01");
    expect(s.lastDate).toBe("2026-01-02"); // latest of c1's rows
  });

  it("account guard: a creative in ANOTHER account yields an empty summary", async () => {
    // Active account is A; CREATIVE_B belongs to account B → nothing to delete.
    const s = await creativeDeletionSummary(CREATIVE_B);
    expect(s.records).toBe(0);
    expect(s.platforms).toEqual([]);
    expect(s.campaigns).toBe(0);
  });
});

describe("Library Priority — sort and filter", () => {
  // Fixture creatives: A-Creative-1, A-Creative-2 (account A). Give one a
  // priority and leave the other unrated.
  beforeEach(async () => {
    await resetAndSeed();
    setAccount(ACCOUNT_A);
    await db.update(creatives).set({ priority: 3 }).where(eq(creatives.id, CREATIVE_1));
    await db.update(creatives).set({ priority: null }).where(eq(creatives.id, CREATIVE_2));
  });

  it("sorts unrated LAST in BOTH directions", async () => {
    const desc = await listCreatives({ sort: "priority-desc" });
    expect(desc.rows.map((r) => r.priority)).toEqual([3, null]);

    // Ascending too: unrated is an absence of judgment, not a low priority —
    // Postgres' default would float the NULL to the top here.
    const asc = await listCreatives({ sort: "priority-asc" });
    expect(asc.rows.map((r) => r.priority)).toEqual([3, null]);
  });

  it("filters by value, by Unrated, and by both together", async () => {
    const rated = await listCreatives({ sort: "name-asc", priorities: ["3"] });
    expect(rated.rows.map((r) => r.id)).toEqual([CREATIVE_1]);

    // "Unrated" has to match NULL explicitly — `IN (…)` never would.
    const unrated = await listCreatives({ sort: "name-asc", priorities: ["unrated"] });
    expect(unrated.rows.map((r) => r.id)).toEqual([CREATIVE_2]);

    const both = await listCreatives({ sort: "name-asc", priorities: ["3", "unrated"] });
    expect(both.rows.map((r) => r.id).sort()).toEqual([CREATIVE_1, CREATIVE_2].sort());

    // A value nobody carries matches nothing (rather than everything).
    const none = await listCreatives({ sort: "name-asc", priorities: ["1"] });
    expect(none.rows).toHaveLength(0);

    // No filter = every creative, and totalMatching agrees.
    const all = await listCreatives({ sort: "name-asc" });
    expect(all.rows.length).toBe(2);
    expect(all.totalMatching).toBe(2);
  });
});

describe("Library Stage — overlap filter and funnel-order sort", () => {
  beforeEach(async () => {
    await resetAndSeed();
    setAccount(ACCOUNT_A);
    // One creative spans two stages, the other is left UNASSIGNED.
    await db
      .update(creatives)
      .set({ stages: ["Awareness", "Retargeting"] })
      .where(eq(creatives.id, CREATIVE_1));
    await db.update(creatives).set({ stages: [] }).where(eq(creatives.id, CREATIVE_2));
  });

  it("matches on OVERLAP — any selected stage on the creative", async () => {
    const awareness = await listCreatives({ sort: "name-asc", stages: ["Awareness"] });
    expect(awareness.rows.map((r) => r.id)).toEqual([CREATIVE_1]);

    // The same creative matches on its OTHER stage too.
    const retargeting = await listCreatives({ sort: "name-asc", stages: ["Retargeting"] });
    expect(retargeting.rows.map((r) => r.id)).toEqual([CREATIVE_1]);

    // A stage nobody carries matches nothing (rather than everything).
    const activation = await listCreatives({ sort: "name-asc", stages: ["Activation"] });
    expect(activation.rows).toHaveLength(0);

    // Selecting both of a creative's stages returns it ONCE, not twice.
    const both = await listCreatives({
      sort: "name-asc",
      stages: ["Awareness", "Retargeting"],
    });
    expect(both.rows.map((r) => r.id)).toEqual([CREATIVE_1]);
  });

  it("Unassigned matches the empty set, and combines with a stage", async () => {
    const unassigned = await listCreatives({ sort: "name-asc", stages: ["unassigned"] });
    expect(unassigned.rows.map((r) => r.id)).toEqual([CREATIVE_2]);

    const either = await listCreatives({
      sort: "name-asc",
      stages: ["Awareness", "unassigned"],
    });
    expect(either.rows.map((r) => r.id).sort()).toEqual([CREATIVE_1, CREATIVE_2].sort());

    // No filter = everything, and the count agrees.
    const all = await listCreatives({ sort: "name-asc" });
    expect(all.rows).toHaveLength(2);
    expect(all.totalMatching).toBe(2);
  });

  it("reads back in funnel order, and sorts unassigned LAST both ways", async () => {
    const desc = await listCreatives({ sort: "stage-desc" });
    // Stored unordered; presented Awareness → Retargeting.
    expect(desc.rows.find((r) => r.id === CREATIVE_1)?.stages).toEqual([
      "Awareness",
      "Retargeting",
    ]);
    expect(desc.rows.map((r) => r.id)).toEqual([CREATIVE_1, CREATIVE_2]);

    const asc = await listCreatives({ sort: "stage-asc" });
    expect(asc.rows.map((r) => r.id)).toEqual([CREATIVE_1, CREATIVE_2]);
  });
});
