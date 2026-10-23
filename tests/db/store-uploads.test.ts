import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A } from "./config";

/**
 * Store uploads and exports through the REAL actions (Wave 1, 2026-10-23):
 * the orders CSV follows the page's range (W1-5), a legacy `.xls` sees the
 * orders already imported (W1-6), values `store_orders` can't hold are
 * validation errors rather than a failed commit (D8), and a long field label
 * no longer hangs `createStoreField` (W1-10). Ported from the system audit's
 * scratch reproductions; each failed on the code before its fix.
 */
const ADMIN = "11111111-1111-1111-1111-111111111111"; // seeded by the fixtures
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
  getActiveAccount: vi.fn(async () => ({ id: ACCOUNT_A, name: "Account A", slug: "a", statusWindowHours: 24 })),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import * as XLSX from "xlsx";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { storeOrderFields, storeOrders } from "@/db/schema";
import { coreFieldRows, systemRequiredFieldRows } from "@/store/fields";
import { commitStoreUpload, validateStoreUpload } from "@/app/actions/store-upload";
import { exportStoreOrders } from "@/app/actions/store-export";
import { createStoreField } from "@/app/actions/store-field";
import { defaultDateRange } from "@/lib/date-presets";
import { resetAndSeed } from "./fixtures";

const HEADERS: Record<string, string[]> = {
  order_id: ["order id"],
  order_date: ["order date"],
  total_amount: ["total"],
};
const HEAD = ["Order ID", "Order date", "Total", "utm_source", "channel"];

function csvForm(csv: string, upsert = false) {
  const fd = new FormData();
  fd.set("file", new File([csv], "orders.csv", { type: "text/csv" }));
  fd.set("upsert", upsert ? "true" : "false");
  return fd;
}
function xlsForm(rows: unknown[][], upsert = false) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Orders");
  const buf = XLSX.write(wb, { type: "array", bookType: "biff8" }) as ArrayBuffer;
  const fd = new FormData();
  fd.set("file", new File([buf], "orders.xls"));
  fd.set("upsert", upsert ? "true" : "false");
  return fd;
}

beforeAll(async () => {
  await resetAndSeed();
  await db.delete(storeOrderFields).where(eq(storeOrderFields.accountId, ACCOUNT_A));
  await db.insert(storeOrderFields).values([
    ...coreFieldRows(ACCOUNT_A).map((r) => ({ ...r, headers: HEADERS[r.key] ?? [] })),
    ...systemRequiredFieldRows(ACCOUNT_A),
  ]);
});
beforeEach(async () => {
  await db.execute(sql`DELETE FROM store_orders`);
  await db.execute(sql`DELETE FROM store_upload_batches`);
});

describe("Orders CSV export — the page's range, not every order ever (W1-5)", () => {
  it("a paramless export is the default range the page shows", async () => {
    const inRange = defaultDateRange().to;
    const seeded = await commitStoreUpload(
      csvForm(`${HEAD.join(",")}\nOLD,2019-03-01,100,,\nRECENT,${inRange},5,,\n`),
    );
    expect(seeded.ok).toBe(true);
    // The button sends searchParams.get("from") ?? undefined — absent here.
    const res = await exportStoreOrders({ from: undefined, to: undefined });
    expect(res.ok).toBe(true);
    expect(res.csv).toContain("RECENT");
    expect(res.csv).not.toContain("OLD");
  });

  it("an explicit range still wins", async () => {
    await commitStoreUpload(csvForm(`${HEAD.join(",")}\nOLD,2019-03-01,100,,\n`));
    const res = await exportStoreOrders({ from: "2019-01-01", to: "2019-12-31" });
    expect(res.csv).toContain("OLD");
  });
});

describe("a legacy .xls sees the orders already imported (W1-6)", () => {
  it("strict mode refuses a re-upload in VALIDATION (S051), as .csv/.xlsx do", async () => {
    await commitStoreUpload(csvForm(`${HEAD.join(",")}\nX1,2026-01-01,100,fb,web\n`));
    const rows = [HEAD, ["X1", "2026-01-01", 100, "fb", "web"], ["X2", "2026-01-01", 50, "fb", "web"]];
    const v = await validateStoreUpload(xlsForm(rows));
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors.map((e) => e.code)).toEqual(["S051"]);
  });

  it("upsert counts an existing order as an update, and the commit lands", async () => {
    await commitStoreUpload(csvForm(`${HEAD.join(",")}\nX1,2026-01-01,100,fb,web\n`));
    const rows = [HEAD, ["X1", "2026-01-01", 999, "fb", "web"], ["X3", "2026-01-02", 10, "tt", "app"]];
    const v = await validateStoreUpload(xlsForm(rows, true));
    expect(v.ok && v.summary).toMatchObject({ newCount: 1, updatedCount: 1 });
    const c = await commitStoreUpload(xlsForm(rows, true));
    expect(c).toMatchObject({ ok: true, rowsInserted: 1, rowsUpdated: 1 });
    const [x1] = await db.select({ t: storeOrders.totalAmount }).from(storeOrders).where(eq(storeOrders.orderId, "X1"));
    expect(Number(x1!.t)).toBe(999);
  });
});

describe("what store_orders can't hold is refused in validation (D8)", () => {
  it("a 65-character order ID and an 11-digit total name the row, and nothing is written", async () => {
    const csv = `${HEAD.join(",")}\n${"L".repeat(65)},2026-01-01,100,,\nBIG,2026-01-01,12345678901,,\n`;
    const v = await validateStoreUpload(csvForm(csv));
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors.map((e) => e.message)).toEqual([
      "Row 2: Order ID is longer than 64 characters.",
      "Row 3: Order total is too large to store.",
    ]);
    const c = await commitStoreUpload(csvForm(csv));
    expect(c.ok).toBe(false);
    if (c.ok) return;
    expect(c.error).not.toBe("Something went wrong — try again.");
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from store_orders`)) as unknown as [{ n: number }];
    expect(n).toBe(0);
  });
});

describe("createStoreField with a long colliding label (W1-10)", () => {
  it("returns a distinct key instead of hanging", async () => {
    const label = "Customer acquisition first touch campaign name XY"; // slug is 48 chars
    expect(await createStoreField({ label, type: "text", required: false, headers: ["a"] })).toEqual({ ok: true });
    const second = await Promise.race([
      createStoreField({ label, type: "text", required: false, headers: ["b"] }),
      new Promise((r) => setTimeout(() => r("HUNG"), 5000)),
    ]);
    expect(second).toEqual({ ok: true });
    const keys = (
      await db.select({ key: storeOrderFields.key }).from(storeOrderFields).where(eq(storeOrderFields.accountId, ACCOUNT_A))
    ).map((r) => r.key);
    expect(keys.filter((k) => k.startsWith("customer_acquisition"))).toHaveLength(2);
  });
});
