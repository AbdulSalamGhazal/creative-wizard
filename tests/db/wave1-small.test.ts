import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A } from "./config";

/**
 * Wave 1's smaller correctness items (W1-13, 2026-10-23), each through the
 * REAL action or route. Ported from the system audit's scratch reproductions.
 */
const ADMIN = "11111111-1111-1111-1111-111111111111";
const actor = {
  id: ADMIN, email: "harness@test.local", name: "Harness", role: "admin" as const,
  permissions: null, allAccounts: true, avatarUrl: null,
};
let denial: Error | null = null;
vi.mock("@/lib/auth", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...orig,
    auth: vi.fn(async () => actor),
    requireAuth: vi.fn(async () => actor),
    requirePermission: vi.fn(async () => {
      if (denial) throw denial;
      return actor;
    }),
  };
});
vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(async () => ({ id: ACCOUNT_A, name: "Account A", slug: "a", statusWindowHours: 24 })),
  listAccounts: vi.fn(async () => [{ id: ACCOUNT_A, name: "Account A", slug: "a", statusWindowHours: 24 }]),
  listAllAccounts: vi.fn(async () => [{ id: ACCOUNT_A, name: "Account A", slug: "a", statusWindowHours: 24 }]),
  allowedAccountsForUser: vi.fn(async () => [{ id: ACCOUNT_A, name: "Account A", slug: "a", statusWindowHours: 24 }]),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { storeOrderFields, storeOrders, uploadBatches } from "@/db/schema";
import { coreFieldRows, systemRequiredFieldRows } from "@/store/fields";
import { createExclusionRule } from "@/app/actions/exclusion-rules";
import { previewBulkCreatives } from "@/app/actions/creative-bulk";
import { rollbackBatch } from "@/app/actions/rollback";
import { commitStoreUpload, rollbackStoreBatch } from "@/app/actions/store-upload";
import { createStoreField, deleteStoreField } from "@/app/actions/store-field";
import { POST as validateRoute } from "@/app/api/uploads/validate/route";
import { CAMPAIGN_1, resetAndSeed } from "./fixtures";

const BATCH_A = "55555555-5555-5555-5555-555555555001"; // the fixtures' Account A batch

beforeEach(async () => {
  denial = null;
  await resetAndSeed();
});

describe("a duplicate exclusion rule gets its own sentence", () => {
  it("not 'Something went wrong'", async () => {
    expect((await createExclusionRule({ target: { kind: "campaign", campaignId: CAMPAIGN_1 } })).ok).toBe(true);
    const second = await createExclusionRule({ target: { kind: "campaign", campaignId: CAMPAIGN_1 } });
    expect(second).toEqual({ ok: false, error: "A rule for that target already exists." });
  });
});

describe("bulk creative import refuses an impossible launch date", () => {
  it("31/02/2026 is an error in the PREVIEW, not a failed commit", async () => {
    const fd = new FormData();
    fd.set("file", new File(["name,product,type,launch_date\nBULK_FEB31,Product A,video,31/02/2026\n"], "c.csv", { type: "text/csv" }));
    const preview = await previewBulkCreatives(fd);
    expect(preview.allValid).toBe(false);
  });
});

describe("concurrent rollbacks: exactly one wins", () => {
  it("ads batch", async () => {
    const results = await Promise.all([rollbackBatch(BATCH_A), rollbackBatch(BATCH_A)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "Batch is not active." }]);
    const [b] = await db.select({ s: uploadBatches.status }).from(uploadBatches).where(eq(uploadBatches.id, BATCH_A));
    expect(b!.s).toBe("rolled_back");
  });

  it("store batch", async () => {
    await db.delete(storeOrderFields).where(eq(storeOrderFields.accountId, ACCOUNT_A));
    await db.insert(storeOrderFields).values([
      ...coreFieldRows(ACCOUNT_A).map((r) => ({
        ...r,
        headers: ({ order_id: ["order id"], order_date: ["order date"], total_amount: ["total"] } as Record<string, string[]>)[r.key] ?? [],
      })),
      ...systemRequiredFieldRows(ACCOUNT_A),
    ]);
    const fd = new FormData();
    fd.set("file", new File(["Order ID,Order date,Total,utm_source,channel\nR1,2026-01-01,10,,\n"], "o.csv", { type: "text/csv" }));
    fd.set("upsert", "false");
    const c = await commitStoreUpload(fd);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const results = await Promise.all([rollbackStoreBatch(c.batchId), rollbackStoreBatch(c.batchId)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "Batch already rolled back." }]);
  });
});

describe("upload routes: 403 for a missing permission, 401 for no session", () => {
  const call = () =>
    validateRoute(
      new NextRequest("http://localhost/api/uploads/validate", { method: "POST", body: new FormData() }),
    );
  it("signed in without upload.import → 403", async () => {
    denial = new Error("Missing permission: upload.import");
    expect((await call()).status).toBe(403);
  });
  it("not signed in → 401", async () => {
    denial = new Error("Unauthorized");
    expect((await call()).status).toBe(401);
  });
});

describe("a re-created store field never resurrects a deleted one's values", () => {
  it("the new field gets a fresh key; the old values stay with the old key", async () => {
    await db.delete(storeOrderFields).where(eq(storeOrderFields.accountId, ACCOUNT_A));
    await db.insert(storeOrderFields).values([
      ...coreFieldRows(ACCOUNT_A).map((r) => ({
        ...r,
        headers: ({ order_id: ["order id"], order_date: ["order date"], total_amount: ["total"] } as Record<string, string[]>)[r.key] ?? [],
      })),
      ...systemRequiredFieldRows(ACCOUNT_A),
    ]);
    expect(await createStoreField({ label: "Coupon", type: "text", required: false, headers: ["coupon"] })).toEqual({ ok: true });
    const fd = new FormData();
    fd.set("file", new File(["Order ID,Order date,Total,utm_source,channel,coupon\nC1,2026-01-01,100,,,SUMMER\n"], "o.csv", { type: "text/csv" }));
    fd.set("upsert", "false");
    expect((await commitStoreUpload(fd)).ok).toBe(true);
    const fieldByLabel = async () =>
      (await db.select().from(storeOrderFields).where(and(eq(storeOrderFields.accountId, ACCOUNT_A), eq(storeOrderFields.label, "Coupon"))))[0]!;
    const first = await fieldByLabel();
    await deleteStoreField(first.id);
    expect(await createStoreField({ label: "Coupon", type: "number", required: false, headers: ["coupon value"] })).toEqual({ ok: true });
    const second = await fieldByLabel();
    expect(second.key).not.toBe(first.key);
    const [o] = await db.select({ a: storeOrders.attributes }).from(storeOrders).where(eq(storeOrders.orderId, "C1"));
    expect((o!.a as Record<string, unknown>)[second.key]).toBeUndefined();
  });
});
