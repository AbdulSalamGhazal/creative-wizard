import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ACCOUNT_A } from "./config";

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

import { db } from "@/lib/db";
import { creatives } from "@/db/schema";
import { creativeSortValues } from "@/validators/creative";
import { listCreativeSequence, listCreatives, type CreativeListFilters } from "@/db/queries/creatives";
import { CREATIVE_1, CREATIVE_2, PRODUCT_A, USER, resetAndSeed } from "./fixtures";

/**
 * W2-4 (2026-10): the detail page's prev/next pager stopped running the whole
 * Library listing. Its sequence must still be the Library's EXACTLY — same
 * creatives, same order — for every sort and every filter the link carries.
 */
beforeAll(async () => {
  await resetAndSeed();
  // A third creative with an angle, a launch date and a priority so every sort
  // has something to separate.
  await db.insert(creatives).values({
    id: "33333333-3333-3333-3333-333333333003",
    accountId: ACCOUNT_A,
    name: "A-Creative-0",
    productId: PRODUCT_A,
    type: "slides",
    launchDate: "2026-01-05",
    priority: 2,
    stages: ["Activation"],
    createdByUserId: USER,
  });
  await db.update(creatives).set({ priority: 3, launchDate: "2026-01-01" }).where(eq(creatives.id, CREATIVE_1));
  await db.update(creatives).set({ stages: ["N/A"] }).where(eq(creatives.id, CREATIVE_2));
});
beforeEach(() => vi.clearAllMocks());

const library = async (f: CreativeListFilters) => (await listCreatives(f)).rows.map((r) => r.name);

describe("listCreativeSequence — the Library's order, without the Library's query", () => {
  it.each(creativeSortValues)("sort %s matches the listing", async (sort) => {
    expect(await listCreativeSequence({ sort })).toEqual(await library({ sort }));
  });

  it.each<[string, Partial<CreativeListFilters>]>([
    ["types", { types: ["video", "image"] }],
    ["priorities", { priorities: ["unrated", "2"] }],
    ["stages", { stages: ["N/A"] }],
    ["statuses", { statuses: ["new"] }],
    ["platforms (status scope)", { platforms: ["facebook"], statuses: ["pause", "active", "new"] }],
    ["search", { q: "Creative-1" }],
    ["Excluded shown, spend sort", { includeExcluded: true, sort: "spend-desc" }],
  ])("filter: %s", async (_label, f) => {
    const filters = { sort: "launched-desc" as const, ...f };
    expect(await listCreativeSequence(filters)).toEqual(await library(filters));
  });
});
