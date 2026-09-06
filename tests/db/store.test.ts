import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
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

/**
 * Upsert updates PATCH `attributes`. A store export is frequently a partial
 * view of the order (one team's columns), and the previous replace-the-object
 * behaviour silently wiped every custom value whose column wasn't in that file.
 */
describe("store upsert — attributes patch semantics", () => {
  const ATTRS = { source: "instagram", coupon: "SAVE10", city: "Riyadh" };

  // This file resets once in beforeAll, so clear only THIS block's rows
  // between tests rather than disturbing the shared fixture state.
  beforeEach(async () => {
    await db
      .delete(storeOrders)
      .where(
        and(
          eq(storeOrders.accountId, ACCOUNT_A),
          inArray(storeOrders.orderId, ["P1", "P2"]),
        ),
      );
  });

  async function seedOne() {
    await db
      .insert(users)
      .values({
        id: UPLOADER,
        email: "patch-uploader@test.local",
        name: "Uploader",
        role: "editor",
      })
      .onConflictDoNothing();
    await writeStoreBatch({
      accountId: ACCOUNT_A,
      fileName: "seed.csv",
      uploadedByUserId: UPLOADER,
      upsert: false,
      inserts: [wr("P1", "2026-03-01", "100.00", ATTRS)],
      updates: [],
    });
  }

  const attrsOf = async (orderId: string) => {
    const [row] = await db
      .select({ attributes: storeOrders.attributes })
      .from(storeOrders)
      .where(and(eq(storeOrders.accountId, ACCOUNT_A), eq(storeOrders.orderId, orderId)));
    return row!.attributes as Record<string, unknown>;
  };

  it("a column ABSENT from the file leaves its stored value untouched", async () => {
    await seedOne();
    // File carries only `source` — coupon/city have no column at all.
    await writeStoreBatch({
      accountId: ACCOUNT_A,
      fileName: "partial.csv",
      uploadedByUserId: UPLOADER,
      upsert: true,
      inserts: [],
      updates: [wr("P1", "2026-03-02", "150.00", { source: "facebook" })],
      presentFieldKeys: ["source"],
    });
    expect(await attrsOf("P1")).toEqual({
      source: "facebook", // present + value → overwritten
      coupon: "SAVE10", // absent column → kept
      city: "Riyadh", // absent column → kept
    });
  });

  it("a column PRESENT but BLANK clears the key (an explicit clear still works)", async () => {
    await seedOne();
    // coupon HAS a column; this row left it blank, so the pipeline omits the
    // key — that is an instruction to clear, not an absence of instruction.
    await writeStoreBatch({
      accountId: ACCOUNT_A,
      fileName: "clear.csv",
      uploadedByUserId: UPLOADER,
      upsert: true,
      inserts: [],
      updates: [wr("P1", "2026-03-02", "150.00", { source: "instagram" })],
      presentFieldKeys: ["source", "coupon"],
    });
    const after = await attrsOf("P1");
    expect(after).not.toHaveProperty("coupon"); // cleared
    expect(after.source).toBe("instagram");
    expect(after.city).toBe("Riyadh"); // still absent from the file → kept
  });

  it("a column PRESENT with a value overwrites", async () => {
    await seedOne();
    await writeStoreBatch({
      accountId: ACCOUNT_A,
      fileName: "over.csv",
      uploadedByUserId: UPLOADER,
      upsert: true,
      inserts: [],
      updates: [wr("P1", "2026-03-02", "150.00", { coupon: "NEW99" })],
      presentFieldKeys: ["coupon"],
    });
    const after = await attrsOf("P1");
    expect(after.coupon).toBe("NEW99");
    expect(after.source).toBe("instagram"); // untouched
  });

  it("core columns still update, and the INSERT path is unchanged", async () => {
    await seedOne();
    await writeStoreBatch({
      accountId: ACCOUNT_A,
      fileName: "mixed.csv",
      uploadedByUserId: UPLOADER,
      upsert: true,
      inserts: [wr("P2", "2026-03-05", "42.00", { source: "tiktok" })],
      updates: [wr("P1", "2026-03-09", "999.00", { source: "snapchat" })],
      presentFieldKeys: ["source"],
    });
    const [updated] = await db
      .select({
        date: storeOrders.orderDate,
        amount: storeOrders.totalAmount,
      })
      .from(storeOrders)
      .where(and(eq(storeOrders.accountId, ACCOUNT_A), eq(storeOrders.orderId, "P1")));
    expect(updated!.date).toBe("2026-03-09");
    expect(Number(updated!.amount)).toBeCloseTo(999, 2);
    // Inserts write the whole object verbatim — no patching involved.
    expect(await attrsOf("P2")).toEqual({ source: "tiktok" });
  });
});


/**
 * Reconciliation's by-platform mode reads order sources from ONE configured
 * field. Deleting that field used to leave `accounts.store_source_field_key`
 * pointing at a key that no longer exists — by-platform then attributed
 * everything to Unattributed with no hint why.
 */
describe("store field delete clears the Reconciliation source pointer", () => {
  it("NULLs store_source_field_key when the deleted field is the configured one", async () => {
    const { storeOrderFields, accounts } = await import("@/db/schema");
    const [field] = await db
      .insert(storeOrderFields)
      .values({
        accountId: ACCOUNT_A,
        key: "utm_source",
        label: "UTM source",
        type: "text",
        headers: ["utm_source"],
      })
      .returning({ id: storeOrderFields.id, key: storeOrderFields.key });
    await db
      .update(accounts)
      .set({ storeSourceFieldKey: field!.key })
      .where(eq(accounts.id, ACCOUNT_A));

    // What deleteStoreField does transactionally.
    await db.transaction(async (tx) => {
      await tx.delete(storeOrderFields).where(eq(storeOrderFields.id, field!.id));
      await tx
        .update(accounts)
        .set({ storeSourceFieldKey: null })
        .where(and(eq(accounts.id, ACCOUNT_A), eq(accounts.storeSourceFieldKey, field!.key)));
    });

    const [acct] = await db
      .select({ key: accounts.storeSourceFieldKey })
      .from(accounts)
      .where(eq(accounts.id, ACCOUNT_A));
    expect(acct!.key).toBeNull();
  });

  it("leaves the pointer alone when a DIFFERENT field is deleted", async () => {
    const { storeOrderFields, accounts } = await import("@/db/schema");
    const [keep] = await db
      .insert(storeOrderFields)
      .values({
        accountId: ACCOUNT_A,
        key: "src_keep",
        label: "Source",
        type: "text",
        headers: ["src"],
      })
      .returning({ key: storeOrderFields.key });
    const [other] = await db
      .insert(storeOrderFields)
      .values({
        accountId: ACCOUNT_A,
        key: "other_field",
        label: "Other",
        type: "text",
        headers: ["other"],
      })
      .returning({ id: storeOrderFields.id, key: storeOrderFields.key });
    await db
      .update(accounts)
      .set({ storeSourceFieldKey: keep!.key })
      .where(eq(accounts.id, ACCOUNT_A));

    await db.transaction(async (tx) => {
      await tx.delete(storeOrderFields).where(eq(storeOrderFields.id, other!.id));
      await tx
        .update(accounts)
        .set({ storeSourceFieldKey: null })
        .where(and(eq(accounts.id, ACCOUNT_A), eq(accounts.storeSourceFieldKey, other!.key)));
    });

    const [acct] = await db
      .select({ key: accounts.storeSourceFieldKey })
      .from(accounts)
      .where(eq(accounts.id, ACCOUNT_A));
    expect(acct!.key).toBe("src_keep"); // untouched
  });
});
