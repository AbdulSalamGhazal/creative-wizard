import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { users } from "@/db/schema";
import {
  writeStoreBatch,
  listStoreOrders,
  previewStoreCleanup,
  deleteStoreOrders,
} from "@/db/queries/store";
import { resetAndSeed } from "./fixtures";

const UPLOADER = "dddddddd-0000-0000-0000-0000000000c1";
const FILTER = { page: 1, sort: "order_date" as const, dir: "desc" as const };
const setAccount = (id: string) =>
  vi.mocked(getActiveAccountId).mockResolvedValue(id);

beforeAll(async () => {
  await resetAndSeed(); // accounts A + B
  await db.insert(users).values({
    id: UPLOADER,
    email: "cleanup-uploader@store.test",
    name: "Uploader",
    role: "editor",
  });
  // Account A: three orders across two months. Account B: one isolation sentinel.
  await writeStoreBatch({
    accountId: ACCOUNT_A,
    fileName: "a.csv",
    uploadedByUserId: UPLOADER,
    upsert: false,
    inserts: [
      { orderId: "O1", orderDate: "2026-02-01", totalAmount: "100.00", attributes: {} },
      { orderId: "O2", orderDate: "2026-02-02", totalAmount: "200.00", attributes: {} },
      { orderId: "O3", orderDate: "2026-03-01", totalAmount: "300.00", attributes: {} },
    ],
    updates: [],
  });
  await writeStoreBatch({
    accountId: ACCOUNT_B,
    fileName: "b.csv",
    uploadedByUserId: UPLOADER,
    upsert: false,
    inserts: [
      { orderId: "B1", orderDate: "2026-02-01", totalAmount: "999.00", attributes: {} },
    ],
    updates: [],
  });
});
beforeEach(() => setAccount(ACCOUNT_A));

describe("store cleanup — preview vs delete, scoping, zero-match", () => {
  it("preview count/total match exactly what delete removes (account-scoped)", async () => {
    const filter = { from: "2026-03-01", to: "2026-03-31" };
    const p = await previewStoreCleanup(filter);
    expect(p.orders).toBe(1); // just O3
    expect(p.sumTotal).toBeCloseTo(300, 2);
    expect(p.from).toBe("2026-03-01");
    expect(p.to).toBe("2026-03-01");

    const deleted = await deleteStoreOrders(filter);
    expect(deleted).toBe(p.orders); // count matches the preview exactly

    // O3 gone; O1/O2 remain for A.
    const remaining = await listStoreOrders(FILTER);
    expect(remaining.total).toBe(2);
    expect(remaining.rows.map((r) => r.orderId).sort()).toEqual(["O1", "O2"]);

    // Account B's order is untouched.
    setAccount(ACCOUNT_B);
    const b = await listStoreOrders(FILTER);
    expect(b.rows.map((r) => r.orderId)).toContain("B1");
  });

  it("is scoped to the active account — A's ids are invisible to B", async () => {
    setAccount(ACCOUNT_B);
    // O1 belongs to A; under B this matches nothing (never touches A's rows).
    const p = await previewStoreCleanup({ orderIds: ["O1"] });
    expect(p.orders).toBe(0);
    expect(await deleteStoreOrders({ orderIds: ["O1"] })).toBe(0);

    const a = await (async () => {
      setAccount(ACCOUNT_A);
      return listStoreOrders(FILTER);
    })();
    expect(a.rows.map((r) => r.orderId)).toContain("O1"); // still there
  });

  it("zero-match previews and deletes cleanly (no empty-inArray throw)", async () => {
    const miss = { orderIds: ["NOPE-1", "NOPE-2"] };
    const p = await previewStoreCleanup(miss);
    expect(p.orders).toBe(0);
    expect(p.sumTotal).toBe(0);
    expect(await deleteStoreOrders(miss)).toBe(0);

    // No filter at all → guarded to "match nothing", never deletes everything.
    expect((await previewStoreCleanup({})).orders).toBe(0);
    expect(await deleteStoreOrders({})).toBe(0);
    const a = await listStoreOrders(FILTER);
    expect(a.total).toBe(2); // O1 + O2 still present
  });
});
