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
import { db } from "@/lib/db";
import { storeOrders, users } from "@/db/schema";
import {
  writeStoreBatch,
  listStoreOrders,
  existingStoreOrderIds,
  type StoreWriteRow,
} from "@/db/queries/store";
import { resetAndSeed } from "./fixtures";

const UPLOADER = "dddddddd-0000-0000-0000-0000000000d1";
const wr = (
  orderId: string,
  orderDate: string,
  totalAmount: string,
  attributes: Record<string, string | number> = {},
): StoreWriteRow => ({ orderId, orderDate, totalAmount, attributes });

const FILTER = { page: 1, sort: "order_date" as const, dir: "desc" as const };

beforeAll(async () => {
  await resetAndSeed(); // accounts A + B
  await db.insert(users).values({
    id: UPLOADER,
    email: "uploader@store.test",
    name: "Uploader",
    role: "editor",
  });
});
beforeEach(() => vi.mocked(getActiveAccountId).mockResolvedValue(ACCOUNT_A));

describe("store — write batch, list, totals, scoping", () => {
  it("inserts a batch's orders; list returns them with a correct totals sum", async () => {
    await writeStoreBatch({
      accountId: ACCOUNT_A,
      fileName: "a.csv",
      uploadedByUserId: UPLOADER,
      upsert: false,
      inserts: [
        wr("O1", "2026-01-01", "100.00", { status: "paid" }),
        wr("O2", "2026-01-02", "250.50"),
      ],
      updates: [],
    });
    const res = await listStoreOrders(FILTER);
    expect(res.total).toBe(2);
    expect(res.sumTotal).toBeCloseTo(350.5, 2);
    // desc by date → O2 first.
    expect(res.rows.map((r) => r.orderId)).toEqual(["O2", "O1"]);
    expect(res.rows[1]!.attributes.status).toBe("paid");
  });

  it("is account-scoped — Account B's orders never appear for Account A", async () => {
    await writeStoreBatch({
      accountId: ACCOUNT_B,
      fileName: "b.csv",
      uploadedByUserId: UPLOADER,
      upsert: false,
      inserts: [wr("B1", "2026-01-03", "999.00")],
      updates: [],
    });
    const a = await listStoreOrders(FILTER);
    expect(a.rows.map((r) => r.orderId)).not.toContain("B1");
    expect(a.total).toBe(2); // still just A's two

    const existing = await existingStoreOrderIds(["O1", "B1", "ZZ"]);
    expect([...existing].sort()).toEqual(["O1"]); // B1 is B's, ZZ absent
  });

  it("date filter + search narrow the set and the totals follow", async () => {
    const byDate = await listStoreOrders({ ...FILTER, from: "2026-01-02", to: "2026-01-02" });
    expect(byDate.total).toBe(1);
    expect(byDate.sumTotal).toBeCloseTo(250.5, 2);

    const bySearch = await listStoreOrders({ ...FILTER, q: "O1" });
    expect(bySearch.total).toBe(1);
    expect(bySearch.rows[0]!.orderId).toBe("O1");
  });
});

describe("store — upsert updates in place; rollback deletes inserts only", () => {
  it("update overwrites the total but KEEPS the original upload_batch_id", async () => {
    // O1 was inserted by batch 1. A second (upsert) batch updates O1 + inserts O4.
    const before = await db
      .select({ id: storeOrders.uploadBatchId })
      .from(storeOrders)
      .where(and(eq(storeOrders.accountId, ACCOUNT_A), eq(storeOrders.orderId, "O1")));
    const batch1 = before[0]!.id;

    const b2 = await writeStoreBatch({
      accountId: ACCOUNT_A,
      fileName: "upsert.csv",
      uploadedByUserId: UPLOADER,
      upsert: true,
      inserts: [wr("O4", "2026-01-05", "40.00")],
      updates: [wr("O1", "2026-01-01", "999.00", { status: "refunded" })],
    });

    const [o1] = await db
      .select({
        total: storeOrders.totalAmount,
        batch: storeOrders.uploadBatchId,
        attrs: storeOrders.attributes,
      })
      .from(storeOrders)
      .where(and(eq(storeOrders.accountId, ACCOUNT_A), eq(storeOrders.orderId, "O1")));
    expect(Number(o1!.total)).toBe(999);
    expect(o1!.batch).toBe(batch1); // NOT b2.batchId — the update kept the original
    expect((o1!.attrs as Record<string, unknown>).status).toBe("refunded");
    expect(b2.rowsInserted).toBe(1);
    expect(b2.rowsUpdated).toBe(1);

    // Rollback of b2 deletes only its INSERTED rows (O4). The updated O1 survives.
    const deleted = await db
      .delete(storeOrders)
      .where(and(eq(storeOrders.accountId, ACCOUNT_A), eq(storeOrders.uploadBatchId, b2.batchId)))
      .returning({ id: storeOrders.id });
    expect(deleted).toHaveLength(1);

    const survivors = await db
      .select({ orderId: storeOrders.orderId })
      .from(storeOrders)
      .where(eq(storeOrders.accountId, ACCOUNT_A));
    const ids = survivors.map((r) => r.orderId).sort();
    expect(ids).toContain("O1"); // updated row survives rollback
    expect(ids).not.toContain("O4"); // inserted row removed
  });
});
