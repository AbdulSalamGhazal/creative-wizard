import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

import { getActiveAccountId } from "@/lib/tenant";
import { previewCleanup } from "@/db/queries/cleanup";
import { db } from "@/lib/db";
import { performanceRecords } from "@/db/schema";
import { resetAndSeed } from "./fixtures";

const setAccount = (id: string) =>
  vi.mocked(getActiveAccountId).mockResolvedValue(id);

beforeAll(async () => {
  await resetAndSeed();
});
beforeEach(() => setAccount(ACCOUNT_A));

describe("previewCleanup()", () => {
  it("preview counts match the rows that would actually be deleted", async () => {
    const p = await previewCleanup({ platforms: ["facebook"] });
    // Ground-truth: count the same predicate directly.
    const actual = await db
      .select({ id: performanceRecords.id })
      .from(performanceRecords)
      .where(
        and(
          eq(performanceRecords.accountId, ACCOUNT_A),
          eq(performanceRecords.platform, "facebook"),
        ),
      );
    expect(p.rows).toBe(actual.length);
    expect(p.rows).toBe(1);
    expect(p.spend).toBeCloseTo(200, 4);
    expect(p.creatives).toBe(1);
  });

  it("is scoped to the active account (A's facebook rows invisible to B)", async () => {
    setAccount(ACCOUNT_B);
    const p = await previewCleanup({ platforms: ["facebook"] });
    expect(p.rows).toBe(0);
  });

  it("matches only the active account's rows", async () => {
    setAccount(ACCOUNT_B);
    const p = await previewCleanup({ platforms: ["instagram"] });
    expect(p.rows).toBe(1); // just B's one row
    expect(p.spend).toBeCloseTo(777, 4);
  });
});
