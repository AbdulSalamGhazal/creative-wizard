import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A } from "./config";

/**
 * The cleanup tools delete EXACTLY what was previewed, or nothing (W1-7,
 * audit B-09, 2026-10-23). Both hard deletes are irreversible; the client
 * now sends the filters it previewed plus the count it showed, and the server
 * refuses — before deleting, and again inside the delete's transaction — when
 * the scope no longer has that many rows. Through the REAL actions.
 */
const ADMIN = "11111111-1111-1111-1111-111111111111";
const actor = {
  id: ADMIN, email: "harness@test.local", name: "Harness", role: "admin" as const,
  permissions: null, allAccounts: true, avatarUrl: null,
};
vi.mock("@/lib/auth", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...orig,
    auth: vi.fn(async () => actor),
    requireAuth: vi.fn(async () => actor),
    requirePermission: vi.fn(async () => actor),
  };
});
vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { performanceRecords, storeOrders } from "@/db/schema";
import { previewCleanupAction, runCleanup } from "@/app/actions/cleanup";
import { previewStoreCleanupAction, runStoreCleanup } from "@/app/actions/store-cleanup";
import { deleteRecords } from "@/db/queries/cleanup";
import { deleteStoreOrders, writeStoreBatch } from "@/db/queries/store";
import { CLEANUP_SCOPE_CHANGED, CleanupScopeChangedError } from "@/lib/cleanup-guard";
import { CAMPAIGN_1, CREATIVE_1, resetAndSeed } from "./fixtures";

const IG = { platforms: ["instagram"] };
const igRows = async () => {
  const [{ n }] = (await db.execute(
    sql`select count(*)::int as n from performance_records where account_id = ${ACCOUNT_A} and platform = 'instagram'`,
  )) as unknown as [{ n: number }];
  return n;
};
const storeRows = async () => {
  const [{ n }] = (await db.execute(sql`select count(*)::int as n from store_orders`)) as unknown as [{ n: number }];
  return n;
};

beforeEach(async () => {
  await resetAndSeed();
  await writeStoreBatch({
    accountId: ACCOUNT_A, fileName: "a.csv", uploadedByUserId: ADMIN, upsert: false,
    inserts: [
      { orderId: "O1", orderDate: "2026-02-01", totalAmount: "100.00", attributes: {} },
      { orderId: "O2", orderDate: "2026-02-02", totalAmount: "200.00", attributes: {} },
    ],
    updates: [],
  });
});

describe("ads record cleanup", () => {
  it("deletes when the count matches the preview", async () => {
    const p = await previewCleanupAction(IG);
    const rows = p.preview!.rows;
    expect(rows).toBeGreaterThan(0);
    expect(await runCleanup({ ...IG, expectedRows: rows })).toEqual({ ok: true, deleted: rows });
    expect(await igRows()).toBe(0);
  });

  it("refuses — and deletes nothing — when the scope grew after the preview", async () => {
    const rows = (await previewCleanupAction(IG)).preview!.rows;
    // Someone uploads another matching day between preview and confirm.
    const [extra] = await db.select().from(performanceRecords).where(
      and(eq(performanceRecords.creativeId, CREATIVE_1), eq(performanceRecords.campaignId, CAMPAIGN_1)),
    ).limit(1);
    await db.insert(performanceRecords).values({ ...extra!, id: undefined, date: "2026-01-09" });
    expect(await runCleanup({ ...IG, expectedRows: rows })).toEqual({ ok: false, error: CLEANUP_SCOPE_CHANGED });
    expect(await igRows()).toBe(rows + 1);
  });

  it("refuses a delete that carries no previewed count", async () => {
    const before = await igRows();
    expect(await runCleanup(IG)).toEqual({ ok: false, error: "Preview the impact before deleting." });
    expect(await igRows()).toBe(before);
  });

  it("the transaction rolls back a delete that removed a different count", async () => {
    const before = await igRows();
    await expect(deleteRecords({ platforms: ["instagram"], productIds: [], creativeIds: [], campaigns: [] }, before - 1))
      .rejects.toBeInstanceOf(CleanupScopeChangedError);
    expect(await igRows()).toBe(before);
  });
});

describe("store order cleanup", () => {
  const RANGE = { from: "2026-02-01", to: "2026-02-28" };
  it("deletes when the count matches the preview", async () => {
    const orders = (await previewStoreCleanupAction(RANGE)).preview!.orders;
    expect(orders).toBe(2);
    expect(await runStoreCleanup({ ...RANGE, expectedRows: orders })).toEqual({ ok: true, deleted: 2 });
    expect(await storeRows()).toBe(0);
  });

  it("refuses — and deletes nothing — on a stale count", async () => {
    expect(await runStoreCleanup({ ...RANGE, expectedRows: 1 })).toEqual({ ok: false, error: CLEANUP_SCOPE_CHANGED });
    expect(await storeRows()).toBe(2);
  });

  it("the transaction rolls back a delete that removed a different count", async () => {
    await expect(deleteStoreOrders({ ...RANGE, orderIds: [] }, 5)).rejects.toBeInstanceOf(CleanupScopeChangedError);
    const rows = await db.select({ id: storeOrders.id }).from(storeOrders);
    expect(rows).toHaveLength(2);
  });
});
