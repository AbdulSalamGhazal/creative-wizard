import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

/**
 * The Salla connector feed against a real database, at production pool size:
 * the raw log dedups, the ordering guard holds, the feed patches only its own
 * attributes, an unlinked store is stored and never applied, uploads and
 * rollback respect "the feed wins", and a feed order buckets on
 * Reconciliation exactly like an uploaded one.
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

import { and, eq, sql } from "drizzle-orm";
import { getActiveAccountId } from "@/lib/tenant";
import { db } from "@/lib/db";
import {
  storeConnections,
  storeConnectorEvents,
  storeOrderItems,
  storeOrderFields,
  storeOrders,
  storeSourceMappings,
} from "@/db/schema";
import { coreFieldRows, systemRequiredFieldRows, STORE_SOURCE_FIELD_KEY } from "@/store/fields";
import { ingestConnectorEvents, pulledOrderEvent } from "@/lib/connector/ingest";
import { storeConnectionStatus, connectorHeldOrderIds } from "@/db/queries/store-connector";
import { riyadhToday } from "@/lib/connector/time";
import {
  commitStoreUpload,
  rollbackStoreBatch,
  validateStoreUpload,
} from "@/app/actions/store-upload";
import { reconciliationByPlatform } from "@/db/queries/reconciliation";
import { listStoreOrders, storeTopProducts } from "@/db/queries/store";
import { listStoreProducts, listStoreProductCosts } from "@/db/queries/store-costs";
import { deleteStoreProductCostAction, setStoreProductCost } from "@/app/actions/store-costs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resetAndSeed } from "./fixtures";

const HEADERS: Record<string, string[]> = {
  order_id: ["order id"],
  order_date: ["order date"],
  total_amount: ["total"],
};
const HEAD = ["Order ID", "Order date", "Total", "utm_source", "channel", "Notes"];

function csvForm(csv: string, upsert = false) {
  const fd = new FormData();
  fd.set("file", new File([csv], "orders.csv", { type: "text/csv" }));
  fd.set("upsert", upsert ? "true" : "false");
  return fd;
}

let seq = 0;
function event(
  store: string,
  reference: string,
  over: {
    type?: string;
    updated?: string;
    total?: number;
    status?: string;
    source?: string | null;
    id?: string;
    items?: unknown[];
    currency?: string;
    rate?: number;
    totalSar?: number;
  } = {},
) {
  const updated = over.updated ?? "2026-11-08T21:00:00+03:00";
  return {
    id: over.id ?? `wizard:${store}:${over.type ?? "order.created"}:${reference}:${++seq}`,
    type: over.type ?? "order.created",
    store,
    occurred_at: updated,
    data: {
      order: {
        reference,
        store,
        created_at: "2026-11-08T20:56:10+03:00",
        updated_at: updated,
        status: { slug: over.status ?? "processing", label: "x" },
        currency: over.currency,
        exchange_rate: over.rate,
        amounts: { total: over.total ?? 100, total_sar: over.totalSar },
        attribution: {
          utm_source: over.source === undefined ? "tiktok" : over.source,
          utm_campaign: "c1",
          device: "mobile",
        },
        items: over.items ?? [{ sku: "SKU-1", name: "Thing", quantity: 2 }],
      },
    },
  };
}

const orderRow = async (acct: string, orderId: string) =>
  (
    await db
      .select()
      .from(storeOrders)
      .where(and(eq(storeOrders.accountId, acct), eq(storeOrders.orderId, orderId)))
  )[0];

beforeAll(async () => {
  await resetAndSeed();
  await db.insert(storeConnections).values([
    { accountId: ACCOUNT_A, storeKey: "urjwan" },
    { accountId: ACCOUNT_B, storeKey: "misbah" },
  ]);
  await db.delete(storeOrderFields).where(eq(storeOrderFields.accountId, ACCOUNT_A));
  await db.insert(storeOrderFields).values([
    ...coreFieldRows(ACCOUNT_A).map((r) => ({ ...r, headers: HEADERS[r.key] ?? [] })),
    ...systemRequiredFieldRows(ACCOUNT_A),
    { accountId: ACCOUNT_A, key: "notes", label: "Notes", type: "text" as const, headers: ["notes"], sortOrder: 9 },
  ]);
});
beforeEach(async () => {
  vi.mocked(getActiveAccountId).mockResolvedValue(ACCOUNT_A);
  await db.execute(sql`DELETE FROM store_orders`);
  await db.execute(sql`DELETE FROM store_upload_batches`);
  await db.execute(sql`DELETE FROM store_connector_events`);
});

describe("ingest — the raw log and the order it applies", () => {
  it("stores the whole payload and inserts the order with no upload batch", async () => {
    const r = await ingestConnectorEvents([event("urjwan", "1001")], "webhook", "live");
    expect(r).toMatchObject({ received: 1, stored: 1, applied: 1, unreadable: 0, unknownStore: 0 });

    const o = await orderRow(ACCOUNT_A, "1001");
    expect(o).toMatchObject({
      orderDate: "2026-11-08",
      totalAmount: "100.00",
      uploadBatchId: null,
      attributes: { utm_source: "tiktok", channel: "mobile", order_status: "processing" },
    });
    expect(o!.connectorUpdatedAt).not.toBeNull();

    const [log] = await db.select().from(storeConnectorEvents);
    expect(log).toMatchObject({ accountId: ACCOUNT_A, storeKey: "urjwan", type: "order.created", via: "webhook" });
    // Everything the connector sent is kept, not just what the pages read.
    const payload = log!.payload as { data: { order: { items: unknown[]; attribution: { utm_campaign: string } } } };
    expect(payload.data.order.items).toHaveLength(1);
    expect(payload.data.order.attribution.utm_campaign).toBe("c1");
  });

  it("a redelivered event is a no-op in the log and changes nothing", async () => {
    const e = event("urjwan", "1002");
    await ingestConnectorEvents([e], "webhook", "live");
    const again = await ingestConnectorEvents([e], "webhook", "live");
    expect(again.stored).toBe(0);
    expect((await db.select().from(storeConnectorEvents)).length).toBe(1);
    expect((await db.select().from(storeOrders)).length).toBe(1);
  });

  it("an OLDER event arriving after a newer one never overwrites it", async () => {
    await ingestConnectorEvents(
      [event("urjwan", "1003", { type: "order.cancelled", updated: "2026-11-09T10:00:00+03:00", status: "cancelled", total: 80 })],
      "webhook", "live",
    );
    const late = await ingestConnectorEvents(
      [event("urjwan", "1003", { type: "order.updated", updated: "2026-11-09T09:00:00+03:00", status: "processing", total: 100 })],
      "webhook", "live",
    );
    expect(late).toMatchObject({ stored: 1, applied: 0 }); // logged, not applied
    expect(await orderRow(ACCOUNT_A, "1003")).toMatchObject({
      totalAmount: "80.00",
      attributes: { order_status: "cancelled" },
    });
  });

  it("two versions of one order in ONE batch apply the newest, whatever their order", async () => {
    const r = await ingestConnectorEvents(
      [
        event("urjwan", "1004", { updated: "2026-11-09T12:00:00+03:00", status: "delivered" }),
        event("urjwan", "1004", { updated: "2026-11-09T11:00:00+03:00", status: "processing" }),
      ],
      "webhook", "live",
    );
    expect(r).toMatchObject({ stored: 2, applied: 1 });
    expect((await orderRow(ACCOUNT_A, "1004"))!.attributes).toMatchObject({ order_status: "delivered" });
  });

  it("record mode logs everything and touches no order", async () => {
    const r = await ingestConnectorEvents([event("urjwan", "1005")], "webhook", "record");
    expect(r).toMatchObject({ stored: 1, applied: 0 });
    expect(await orderRow(ACCOUNT_A, "1005")).toBeUndefined();
  });

  it("an unlinked store is stored raw and never applied; a malformed event is dropped", async () => {
    const r = await ingestConnectorEvents(
      [event("urjwan_brush", "1006"), "not an event", { id: "x" }],
      "webhook", "live",
    );
    expect(r).toMatchObject({ received: 1, stored: 1, applied: 0, unknownStore: 1 });
    const [log] = await db.select().from(storeConnectorEvents);
    expect(log!.accountId).toBeNull();
    expect((await db.select().from(storeOrders)).length).toBe(0);
  });

  it("an order that can't be a Store row is kept raw and counted, not fatal", async () => {
    const bad = event("urjwan", "1007");
    (bad.data.order as { created_at: string | null }).created_at = null;
    const r = await ingestConnectorEvents([bad, event("urjwan", "1008")], "webhook", "live");
    expect(r).toMatchObject({ stored: 2, applied: 1, unreadable: 1 });
  });

  it("each store lands in ITS brand — the same reference in two stores is two orders", async () => {
    await ingestConnectorEvents(
      [event("urjwan", "2000", { total: 10 }), event("misbah", "2000", { total: 20 })],
      "webhook", "live",
    );
    expect((await orderRow(ACCOUNT_A, "2000"))!.totalAmount).toBe("10.00");
    expect((await orderRow(ACCOUNT_B, "2000"))!.totalAmount).toBe("20.00");
  });

  it("a pulled order goes through the same path, and pulling it twice is a no-op", async () => {
    const o = event("urjwan", "1009").data.order;
    const first = await ingestConnectorEvents([pulledOrderEvent("urjwan", o)], "pull", "live");
    const second = await ingestConnectorEvents([pulledOrderEvent("urjwan", o)], "pull", "live");
    expect(first).toMatchObject({ stored: 1, applied: 1 });
    expect(second.stored).toBe(0);
    const [log] = await db.select().from(storeConnectorEvents);
    expect(log).toMatchObject({ via: "pull", type: "order.snapshot" });
  });
});

describe("the feed patches only its own attributes", () => {
  it("takes over an uploaded order: its keys replaced, the upload's other columns kept, the batch kept", async () => {
    const up = await commitStoreUpload(
      csvForm(`${HEAD.join(",")}\n3001,2026-11-07,55,fb,web,Riyadh\n`),
    );
    expect(up.ok).toBe(true);
    await ingestConnectorEvents([event("urjwan", "3001", { total: 60, source: null })], "webhook", "live");
    const o = await orderRow(ACCOUNT_A, "3001");
    // utm_source came back null from Salla → removed, not left as the file's "fb".
    expect(o!.attributes).toEqual({
      channel: "mobile", order_status: "processing", utm_campaign: "c1", notes: "Riyadh",
    });
    expect(o).toMatchObject({ totalAmount: "60.00", orderDate: "2026-11-08" });
    expect(o!.uploadBatchId).toBe(up.ok ? up.batchId : "");
  });
});

describe("uploads coexist — the Salla feed wins", () => {
  const FILE = `${HEAD.join(",")}\n4001,2026-01-01,1,fb,web,Jeddah\n4002,2026-11-08,70,ig,web,Dammam\n`;

  it("strict mode does not refuse a file for an order the feed holds, and says how many", async () => {
    await ingestConnectorEvents([event("urjwan", "4001", { total: 100 })], "webhook", "live");
    expect([...(await connectorHeldOrderIds(ACCOUNT_A, ["4001", "4002"]))]).toEqual(["4001"]);
    const v = await validateStoreUpload(csvForm(FILE));
    expect(v.ok && v.summary).toMatchObject({ newCount: 1, updatedCount: 0, syncedCount: 1 });
  });

  it("the commit keeps the feed's date, total, source, channel and status, and adds the extra column", async () => {
    await ingestConnectorEvents([event("urjwan", "4001", { total: 100 })], "webhook", "live");
    for (const upsert of [false, true]) {
      const c = await commitStoreUpload(csvForm(FILE.replace("4002", upsert ? "4003" : "4002"), upsert));
      expect(c.ok).toBe(true);
      expect(await orderRow(ACCOUNT_A, "4001")).toMatchObject({
        orderDate: "2026-11-08",
        totalAmount: "100.00",
        attributes: { utm_source: "tiktok", channel: "mobile", order_status: "processing", notes: "Jeddah" },
      });
    }
    // The order the feed does not hold is an ordinary insert.
    expect(await orderRow(ACCOUNT_A, "4002")).toMatchObject({
      totalAmount: "70.00",
      attributes: { utm_source: "ig", channel: "web", notes: "Dammam" },
    });
  });

  it("a blank cell in the file can't clear a feed-owned value, but clears its own column", async () => {
    await ingestConnectorEvents([event("urjwan", "4001")], "webhook", "live");
    await commitStoreUpload(csvForm(`${HEAD.join(",")}\n4001,2026-01-01,1,fb,web,Jeddah\n`, true));
    await commitStoreUpload(csvForm(`${HEAD.join(",")}\n4001,2026-01-01,1,,,\n`, true));
    expect((await orderRow(ACCOUNT_A, "4001"))!.attributes).toEqual({
      utm_source: "tiktok", channel: "mobile", order_status: "processing", utm_campaign: "c1",
    });
  });

  it("an order uploaded BEFORE the feed is still an S051 in strict mode until the feed writes it", async () => {
    await commitStoreUpload(csvForm(`${HEAD.join(",")}\n4010,2026-01-01,1,fb,web,X\n`));
    const v = await validateStoreUpload(csvForm(`${HEAD.join(",")}\n4010,2026-01-01,1,fb,web,X\n`));
    expect(v.ok).toBe(false);
  });

  it("rollback deletes what only the upload wrote and DETACHES what the feed has since written", async () => {
    const c = await commitStoreUpload(csvForm(FILE));
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    await ingestConnectorEvents([event("urjwan", "4001")], "webhook", "live");
    const r = await rollbackStoreBatch(c.batchId);
    expect(r).toMatchObject({ ok: true, removed: 1 });
    expect(await orderRow(ACCOUNT_A, "4002")).toBeUndefined();
    expect(await orderRow(ACCOUNT_A, "4001")).toMatchObject({ uploadBatchId: null });
  });
});

describe("what the pages read", () => {
  it("a feed order buckets on Reconciliation exactly like an uploaded one", async () => {
    await db.insert(storeSourceMappings).values({ accountId: ACCOUNT_A, rawValue: "tiktok", platform: "tiktok" });
    await ingestConnectorEvents([event("urjwan", "5001")], "webhook", "live");
    await commitStoreUpload(csvForm(`${HEAD.join(",")}\n5002,2026-11-08,10,tiktok,web,X\n`));
    const recon = await reconciliationByPlatform(STORE_SOURCE_FIELD_KEY, "2026-11-08", "2026-11-08", false);
    const day = recon.rows.find((r) => r.day === "2026-11-08");
    // One from the feed, one from a file — the same bucket, nothing unattributed.
    expect(day).toMatchObject({ storeOrders: 2, unattributed: 0 });
    expect(day!.storeByPlatform.tiktok).toBe(2);
  });

  it("the connection status is the active brand's own, and null for an unlinked brand", async () => {
    await db.execute(sql`UPDATE store_connections SET last_event_at = NULL`);
    await ingestConnectorEvents([event("misbah", "6001")], "webhook", "live");
    // A's store got nothing; B's event must not show on A.
    const a = await storeConnectionStatus();
    expect(a).toMatchObject({ storeKey: "urjwan", lastEventAt: null, ordersToday: 0 });

    await db.delete(storeConnections).where(eq(storeConnections.accountId, ACCOUNT_A));
    vi.resetModules();
    const fresh = await import("@/db/queries/store-connector");
    expect(await fresh.storeConnectionStatus()).toBeNull();
    await db.insert(storeConnections).values({ accountId: ACCOUNT_A, storeKey: "urjwan" });
    expect(riyadhToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("product lines", () => {
  const W = "2026-11-08T21:00:00+03:00";
  const lines = async (acct: string, orderId: string) => {
    const o = await orderRow(acct, orderId);
    if (!o) return [];
    return db
      .select({
        position: storeOrderItems.position,
        sku: storeOrderItems.sku,
        name: storeOrderItems.name,
        quantity: storeOrderItems.quantity,
        lineTotalSar: storeOrderItems.lineTotalSar,
      })
      .from(storeOrderItems)
      .where(eq(storeOrderItems.storeOrderId, o.id))
      .orderBy(storeOrderItems.position);
  };
  const watch = { sku: "S005-Silver", name: "ساعة ألترا 3", quantity: 1, unit_price: 260, total: 299 };
  const strap = { sku: "A010-Black", name: "Strap", quantity: 2.4, total: 98 };

  it("the feed writes each order's lines in SAR, in order; a foreign order converts with its rate", async () => {
    await ingestConnectorEvents(
      [
        event("urjwan", "7001", { items: [watch, strap, "junk", { sku: "Q", total: 5 }] }),
        event("urjwan", "7002", { currency: "QAR", rate: 1.0267, total: 305.88, totalSar: 314.05, items: [{ ...watch, total: 100 }] }),
        event("urjwan", "7003", { currency: "AED", total: 50, items: [{ ...watch, total: 50 }] }),
      ],
      "webhook", "live",
    );
    expect(await lines(ACCOUNT_A, "7001")).toEqual([
      { position: 0, sku: "S005-Silver", name: "ساعة ألترا 3", quantity: 1, lineTotalSar: "299.00" },
      // A fractional quantity rounds; a non-object line and a line with no quantity are skipped.
      { position: 1, sku: "A010-Black", name: "Strap", quantity: 2, lineTotalSar: "98.00" },
    ]);
    expect((await lines(ACCOUNT_A, "7002"))[0]?.lineTotalSar).toBe("102.67");
    // AED with no total_sar is not applied at all — no order, so no lines.
    expect(await orderRow(ACCOUNT_A, "7003")).toBeUndefined();
  });

  it("a newer version replaces the lines; an older one, or record mode, leaves them", async () => {
    await ingestConnectorEvents([event("urjwan", "7010", { updated: W, items: [watch] })], "webhook", "live");
    await ingestConnectorEvents(
      [event("urjwan", "7010", { updated: "2026-11-08T22:00:00+03:00", items: [strap] })],
      "webhook", "live",
    );
    expect((await lines(ACCOUNT_A, "7010")).map((l) => l.sku)).toEqual(["A010-Black"]);
    await ingestConnectorEvents(
      [event("urjwan", "7010", { updated: "2026-11-08T20:00:00+03:00", items: [watch] })],
      "webhook", "live",
    );
    await ingestConnectorEvents(
      [event("urjwan", "7010", { updated: "2026-11-09T09:00:00+03:00", items: [watch] })],
      "webhook", "record",
    );
    expect((await lines(ACCOUNT_A, "7010")).map((l) => l.sku)).toEqual(["A010-Black"]);
  });

  it("deleting an order deletes its lines; the page reads only the active brand's", async () => {
    await ingestConnectorEvents(
      [event("urjwan", "7020", { items: [watch] }), event("misbah", "7020", { items: [strap] })],
      "webhook", "live",
    );
    const page = await listStoreOrders({ from: "2026-11-08", to: "2026-11-08", page: 1, sort: "order_date", dir: "desc" });
    expect(page.rows).toHaveLength(1);
    const items = Object.values(page.itemsByOrder).flat();
    expect(items).toEqual([{ sku: "S005-Silver", name: "ساعة ألترا 3", quantity: 1, lineTotal: 299, unitCost: null }]);

    await db.delete(storeOrders).where(eq(storeOrders.accountId, ACCOUNT_A));
    const left = await db.select({ a: storeOrderItems.accountId }).from(storeOrderItems);
    expect(left).toEqual([{ a: ACCOUNT_B }]);
  });

  it("top products sum quantity and SAR by SKU; upload-only orders are counted apart", async () => {
    await ingestConnectorEvents(
      [
        event("urjwan", "7030", { items: [watch, strap] }),
        event("urjwan", "7031", { items: [{ ...watch, quantity: 3, total: 897 }] }),
        event("misbah", "7032", { items: [{ ...watch, quantity: 50, total: 1 }] }),
      ],
      "webhook", "live",
    );
    await commitStoreUpload(csvForm(`${HEAD.join(",")}\n7033,2026-11-08,10,tiktok,web,X\n`));
    const top = await storeTopProducts("2026-11-08", "2026-11-08");
    expect(top.rows).toEqual([
      { sku: "S005-Silver", name: "ساعة ألترا 3", quantity: 4, orders: 2, sales: 1196, cogs: 0, unitsWithoutCost: 4, grossProfit: null },
      { sku: "A010-Black", name: "Strap", quantity: 2, orders: 1, sales: 98, cogs: 0, unitsWithoutCost: 2, grossProfit: null },
    ]);
    expect(top.ordersWithoutProducts).toBe(1);
  });

  it("the backfill migration fills lines from the raw log for feed orders that have none", async () => {
    await ingestConnectorEvents(
      [
        event("urjwan", "7040", { updated: W, items: [watch] }),
        event("urjwan", "7040", { updated: "2026-11-08T22:00:00+03:00", items: [watch, strap] }),
        event("urjwan", "7041", { currency: "QAR", rate: 2, totalSar: 20, items: [{ ...watch, total: 10 }] }),
      ],
      "webhook", "live",
    );
    await db.delete(storeOrderItems);
    const file = path.join(process.cwd(), "db/migrations/0077_store_order_items_backfill.sql");
    await db.execute(sql.raw(readFileSync(file, "utf8")));
    expect(await lines(ACCOUNT_A, "7040")).toEqual([
      { position: 0, sku: "S005-Silver", name: "ساعة ألترا 3", quantity: 1, lineTotalSar: "299.00" },
      { position: 1, sku: "A010-Black", name: "Strap", quantity: 2, lineTotalSar: "98.00" },
    ]);
    expect((await lines(ACCOUNT_A, "7041"))[0]?.lineTotalSar).toBe("20.00");
    // Running it again adds nothing.
    await db.execute(sql.raw(readFileSync(file, "utf8")));
    expect(await lines(ACCOUNT_A, "7040")).toHaveLength(2);
  });
});

describe("every Salla field", () => {
  it("the feed owns its fields: a later version without a coupon removes it; an upload column stays", async () => {
    const withCoupon = event("urjwan", "8001", { updated: "2026-11-08T21:00:00+03:00" });
    (withCoupon.data.order as Record<string, unknown>).coupons = [{ code: "SALE10", discount: 10 }];
    (withCoupon.data.order as Record<string, unknown>).shipping = { city: "Riyadh" };
    (withCoupon.data.order as Record<string, unknown>).amounts = { total: 100, subtotal_excl_vat: 80 };
    await ingestConnectorEvents([withCoupon], "webhook", "live");
    await commitStoreUpload(csvForm(`${HEAD.join(",")}\n8001,2026-11-08,1,fb,web,keep me\n`, true));
    expect((await orderRow(ACCOUNT_A, "8001"))!.attributes).toMatchObject({
      coupon_code: "SALE10",
      coupon_discount: 10,
      city: "Riyadh",
      notes: "keep me",
      // Money is a JSON number, like an uploaded number field.
      subtotal: 80,
    });

    await ingestConnectorEvents(
      [event("urjwan", "8001", { updated: "2026-11-08T22:00:00+03:00" })],
      "webhook", "live",
    );
    const after = (await orderRow(ACCOUNT_A, "8001"))!.attributes as Record<string, unknown>;
    expect(after).not.toHaveProperty("coupon_code");
    expect(after).not.toHaveProperty("city");
    expect(after.notes).toBe("keep me");
  });
});

describe("product costs and COGS", () => {
  const watch = { sku: "S005-Black", name: "Ultra 3", quantity: 1, total: 299 };
  const onDay = (ref: string, day: string, items: unknown[], store = "urjwan") => {
    const e = event(store, ref, { updated: `${day}T21:00:00+03:00`, items });
    (e.data.order as Record<string, unknown>).created_at = `${day}T20:00:00+03:00`;
    return e;
  };
  beforeEach(async () => {
    await db.execute(sql`DELETE FROM store_product_costs`);
  });

  it("an order line costs what was in force on the order's date", async () => {
    await ingestConnectorEvents(
      [
        onDay("9101", "2026-10-31", [watch]),
        onDay("9102", "2026-11-08", [watch]),
        onDay("9103", "2026-11-10", [{ ...watch, quantity: 2, total: 598 }]),
      ],
      "webhook", "live",
    );
    expect(await setStoreProductCost({ productKey: "S005-Black", unitCost: "80", effectiveFrom: "2026-11-01" })).toEqual({ ok: true });
    expect(await setStoreProductCost({ productKey: "S005-Black", unitCost: "90.5", effectiveFrom: "2026-11-09" })).toEqual({ ok: true });

    const page = await listStoreOrders({ from: "2026-10-01", to: "2026-11-30", page: 1, sort: "order_date", dir: "asc" });
    const costOf = (orderId: string) => {
      const row = page.rows.find((r) => r.orderId === orderId)!;
      return page.itemsByOrder[row.id]?.[0]?.unitCost;
    };
    expect(costOf("9101")).toBeNull(); // before any cost
    expect(costOf("9102")).toBe(80);
    expect(costOf("9103")).toBe(90.5);

    const top = await storeTopProducts("2026-10-01", "2026-11-30");
    expect(top.rows[0]).toMatchObject({
      sku: "S005-Black",
      quantity: 4,
      cogs: 80 + 2 * 90.5,
      unitsWithoutCost: 1,
      // Sales before VAT of the costed lines (299 + 598 → 260 + 520) minus their cost.
      grossProfit: 260 + 520 - (80 + 181),
    });
  });

  it("the same day replaces its cost; a removed cost is gone; bad input is refused", async () => {
    await ingestConnectorEvents([onDay("9110", "2026-11-08", [watch])], "webhook", "live");
    await setStoreProductCost({ productKey: "S005-Black", unitCost: "70", effectiveFrom: "2026-11-01" });
    await setStoreProductCost({ productKey: "S005-Black", unitCost: "75", effectiveFrom: "2026-11-01" });
    const history = await listStoreProductCosts();
    expect(history.map((h) => [h.effectiveFrom, h.unitCost])).toEqual([["2026-11-01", 75]]);

    expect((await setStoreProductCost({ productKey: "S005-Black", unitCost: "-1", effectiveFrom: "2026-11-01" })).ok).toBe(false);
    expect((await setStoreProductCost({ productKey: "S005-Black", unitCost: "12.345", effectiveFrom: "2026-11-01" })).ok).toBe(false);
    expect((await setStoreProductCost({ productKey: "", unitCost: "1", effectiveFrom: "2026-11-01" })).ok).toBe(false);

    expect(await deleteStoreProductCostAction({ id: history[0]!.id })).toEqual({ ok: true });
    expect(await listStoreProductCosts()).toEqual([]);
    expect((await deleteStoreProductCostAction({ id: history[0]!.id })).ok).toBe(false);
  });

  it("the products list is the brand's own, with today's cost; another brand's cost never applies", async () => {
    await ingestConnectorEvents(
      [onDay("9120", "2026-11-08", [watch, { sku: null, name: "No-SKU thing", quantity: 3, total: 30 }]), onDay("9121", "2026-11-08", [watch], "misbah")],
      "webhook", "live",
    );
    await setStoreProductCost({ productKey: "No-SKU thing", unitCost: "4", effectiveFrom: "2026-11-01" });
    vi.mocked(getActiveAccountId).mockResolvedValue(ACCOUNT_B);
    await setStoreProductCost({ productKey: "S005-Black", unitCost: "999", effectiveFrom: "2026-11-01" });
    vi.mocked(getActiveAccountId).mockResolvedValue(ACCOUNT_A);

    const products = await listStoreProducts("2026-11-23");
    expect(products.map((p) => [p.productKey, p.currentCost])).toEqual(
      expect.arrayContaining([
        ["S005-Black", null],
        ["No-SKU thing", 4],
      ]),
    );
    expect(products).toHaveLength(2);
    const page = await listStoreOrders({ from: "2026-11-08", to: "2026-11-08", page: 1, sort: "order_date", dir: "asc" });
    expect(Object.values(page.itemsByOrder).flat().map((l) => l.unitCost)).toEqual([null, 4]);
  });
});
