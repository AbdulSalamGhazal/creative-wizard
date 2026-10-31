import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A } from "./config";

/**
 * The 2026-10-31 bug sweep's action fixes, each through the REAL action:
 * a success that wrote nothing, a name that trimmed to nothing, and the last
 * admin demoted by a race.
 */
const ADMIN = "11111111-1111-1111-1111-111111111111"; // seeded by the fixtures
const ADMIN_2 = "11111111-1111-1111-1111-1111111111e2";
const actorFor = (id: string) => ({
  id, email: `${id}@test.local`, name: "Harness", role: "admin" as const,
  permissions: null, allAccounts: true, avatarUrl: null,
});
vi.mock("@/lib/auth", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...orig,
    auth: vi.fn(async () => actorFor(ADMIN)),
    requireAuth: vi.fn(async () => actorFor(ADMIN)),
    requirePermission: vi.fn(async () => actorFor(ADMIN)),
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

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { creatives, products, users } from "@/db/schema";
import { createProduct, restoreProduct } from "@/app/actions/product";
import { updateCreativeNotes } from "@/app/actions/creative";
import { updateUserAccess } from "@/app/actions/user";
import { CREATIVE_1, CREATIVE_B, PRODUCT_B, resetAndSeed } from "./fixtures";

beforeEach(async () => {
  await resetAndSeed();
  vi.mocked(requirePermission).mockResolvedValue(actorFor(ADMIN) as never);
});

describe("a write that matched nothing says so", () => {
  it("notes on another brand's creative — not 'saved'", async () => {
    const res = await updateCreativeNotes(CREATIVE_B, "hello");
    expect(res).toEqual({ ok: false, error: "Creative not found." });
    const [b] = await db.select({ notes: creatives.notes }).from(creatives).where(eq(creatives.id, CREATIVE_B));
    expect(b?.notes).toBeNull();
  });

  it("notes on our own creative still save", async () => {
    expect(await updateCreativeNotes(CREATIVE_1, "hello")).toEqual({ ok: true });
  });

  it("restoring another brand's product — not 'restored'", async () => {
    await db.update(products).set({ status: "archived" }).where(eq(products.id, PRODUCT_B));
    expect(await restoreProduct(PRODUCT_B)).toEqual({ ok: false, error: "Product not found." });
    const [b] = await db.select({ status: products.status }).from(products).where(eq(products.id, PRODUCT_B));
    expect(b?.status).toBe("archived");
  });
});

describe("a product name is trimmed before it is measured", () => {
  it("refuses a name of spaces", async () => {
    const res = await createProduct({ name: "   " });
    expect(res.ok).toBe(false);
    expect(await db.select().from(products).where(eq(products.name, ""))).toHaveLength(0);
  });

  it("stores a padded name trimmed", async () => {
    expect((await createProduct({ name: "  Serum  " })).ok).toBe(true);
    expect(await db.select().from(products).where(eq(products.name, "Serum"))).toHaveLength(1);
  });
});

describe("the last admin survives two admins demoting each other at once", () => {
  it("one demotion lands, the other is refused", async () => {
    await db.insert(users).values({ id: ADMIN_2, email: "admin2@test.local", name: "Admin Two", role: "admin" });
    // ADMIN demotes ADMIN_2 while ADMIN_2 demotes ADMIN. At production pool
    // size the two actions' statements interleave — both used to count two
    // admins, both succeeded, and the team had none.
    vi.mocked(requirePermission)
      .mockResolvedValueOnce(actorFor(ADMIN) as never)
      .mockResolvedValueOnce(actorFor(ADMIN_2) as never);
    const results = await Promise.all([
      updateUserAccess({ userId: ADMIN_2, role: "editor", permissions: null }),
      updateUserAccess({ userId: ADMIN, role: "editor", permissions: null }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)?.error).toBe("Can't remove the last admin.");
    const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
    expect(admins).toHaveLength(1);
  });
});
