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

/**
 * Rolling back a batch deletes its rows outright. When a LATER upsert has
 * revised some of them, that discards the newer values too — so the confirm
 * dialog counts them. `updated_at` is written only by the upsert UPDATE path;
 * NULL means "never overwritten since import".
 */
describe("rollback since-updated counts", () => {
  it("ads: counts only rows revised AFTER the batch's own upload time", async () => {
    const { batchRowsUpdatedSince } = await import("@/db/queries/performance");
    const { performanceRecords, uploadBatches } = await import("@/db/schema");

    const [batch] = await db
      .select({ id: uploadBatches.id, uploadedAt: uploadBatches.uploadedAt })
      .from(uploadBatches)
      .where(eq(uploadBatches.accountId, ACCOUNT_A))
      .limit(1);

    // Nothing upserted yet → every row's updated_at is NULL.
    expect(await batchRowsUpdatedSince(ACCOUNT_A, batch!.id)).toBe(0);

    const rows = await db
      .select({ id: performanceRecords.id })
      .from(performanceRecords)
      .where(eq(performanceRecords.uploadBatchId, batch!.id))
      .limit(2);

    // One row revised AFTER the batch landed → counted.
    await db
      .update(performanceRecords)
      .set({ updatedAt: new Date(batch!.uploadedAt.getTime() + 60_000) })
      .where(eq(performanceRecords.id, rows[0]!.id));
    expect(await batchRowsUpdatedSince(ACCOUNT_A, batch!.id)).toBe(1);

    // One stamped BEFORE the batch's own upload time → not a later revision.
    await db
      .update(performanceRecords)
      .set({ updatedAt: new Date(batch!.uploadedAt.getTime() - 60_000) })
      .where(eq(performanceRecords.id, rows[1]!.id));
    expect(await batchRowsUpdatedSince(ACCOUNT_A, batch!.id)).toBe(1);
  });

  it("store: counts a batch's inserted orders revised after it landed", async () => {
    const { writeStoreBatch, storeBatchRowsUpdatedSince } = await import("@/db/queries/store");
    const { storeOrders, storeUploadBatches, users } = await import("@/db/schema");
    const UP = "eeeeeeee-0000-0000-0000-0000000000e1";
    await db
      .insert(users)
      .values({ id: UP, email: "rb@test.local", name: "RB", role: "editor" })
      .onConflictDoNothing();

    const { batchId } = await writeStoreBatch({
      accountId: ACCOUNT_A,
      fileName: "rb.csv",
      uploadedByUserId: UP,
      upsert: false,
      inserts: [{ orderId: "RB1", orderDate: "2026-04-01", totalAmount: "10.00", attributes: {} }],
      updates: [],
    });
    const [batch] = await db
      .select({ uploadedAt: storeUploadBatches.uploadedAt })
      .from(storeUploadBatches)
      .where(eq(storeUploadBatches.id, batchId));

    // writeStoreBatch's insert path leaves updated_at at its default; nothing
    // has revised the row yet.
    expect(await storeBatchRowsUpdatedSince(ACCOUNT_A, batchId)).toBe(0);

    // A later upsert revises it.
    await db
      .update(storeOrders)
      .set({ updatedAt: new Date(batch!.uploadedAt.getTime() + 60_000) })
      .where(eq(storeOrders.orderId, "RB1"));
    expect(await storeBatchRowsUpdatedSince(ACCOUNT_A, batchId)).toBe(1);
  });
});
