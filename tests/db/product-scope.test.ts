import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A } from "./config";

/**
 * "Every creative has a product_id" and "re-validate a caller-supplied FK
 * against the active account before writing" (tenancy-auth.md), through the
 * real actions: a creative can't be created on — or moved to — another
 * brand's product, and archive/restore can't reach another brand's product.
 */
const USER = "11111111-1111-1111-1111-111111111111"; // seeded by the fixtures

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));
vi.mock("@/lib/auth", () => ({
  requirePermission: vi.fn(async () => ({ id: USER, role: "admin" })),
  auth: vi.fn(async () => ({ id: USER, role: "admin" })),
  can: vi.fn(() => true),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditEvents, creatives, products } from "@/db/schema";
import { createCreative, patchCreative } from "@/app/actions/creative";
import { archiveProduct, restoreProduct } from "@/app/actions/product";
import { CREATIVE_1, PRODUCT_A, PRODUCT_B, resetAndSeed } from "./fixtures";

const productOf = async (creativeId: string) =>
  (await db.select({ p: creatives.productId }).from(creatives).where(eq(creatives.id, creativeId)))[0]!.p;
const statusOf = async (productId: string) =>
  (await db.select({ s: products.status }).from(products).where(eq(products.id, productId)))[0]!.s;

beforeEach(async () => {
  await resetAndSeed();
});

describe("a creative's product is always the active brand's", () => {
  it("createCreative refuses another brand's product and writes nothing", async () => {
    const res = await createCreative({ name: "zz-a06 Foreign", productId: PRODUCT_B, type: "image" });
    expect(res).toMatchObject({ ok: false, fieldErrors: { productId: "Invalid product" } });
    expect(await db.select().from(creatives).where(eq(creatives.name, "zz-a06 Foreign"))).toEqual([]);
  });

  it("patchCreative refuses moving a creative onto another brand's product", async () => {
    const res = await patchCreative({ id: CREATIVE_1, productId: PRODUCT_B });
    expect(res).toMatchObject({ ok: false, fieldErrors: { productId: "Invalid product" } });
    expect(await productOf(CREATIVE_1)).toBe(PRODUCT_A);
  });
});

describe("archive / restore stay inside the active brand", () => {
  it("archiving another brand's product is not found — B's product stays active", async () => {
    expect(await archiveProduct(PRODUCT_B)).toEqual({ ok: false, error: "Product not found." });
    expect(await statusOf(PRODUCT_B)).toBe("active");
  });

  it("restoring another brand's archived product changes nothing in B", async () => {
    await db.update(products).set({ status: "archived" }).where(eq(products.id, PRODUCT_B));
    await restoreProduct(PRODUCT_B);
    expect(await statusOf(PRODUCT_B)).toBe("archived");
  });

  it("archive then restore round-trips the brand's own product", async () => {
    expect(await archiveProduct(PRODUCT_A)).toEqual({ ok: true });
    expect(await statusOf(PRODUCT_A)).toBe("archived");
    expect(await restoreProduct(PRODUCT_A)).toEqual({ ok: true });
    expect(await statusOf(PRODUCT_A)).toBe("active");
  });

  // Was a bug until 1552427: restoreProduct answered { ok: true } and wrote a
  // `product.restore` audit row with a null label for an id the brand doesn't
  // have, so brand A's audit feed claimed a restore that never happened.
  it("restoring an id the brand doesn't have says so, and audits nothing", async () => {
    await db.update(products).set({ status: "archived" }).where(eq(products.id, PRODUCT_B));
    expect(await restoreProduct(PRODUCT_B)).toEqual({ ok: false, error: "Product not found." });
    expect(await db.select().from(auditEvents).where(eq(auditEvents.action, "product.restore"))).toEqual([]);
  });
});
