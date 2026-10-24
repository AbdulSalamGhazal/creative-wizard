import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A } from "./config";

/**
 * Wave 3 (2026-10-24) through the REAL actions: the Store rollback notifies
 * like the ads one (D30) and an exclusion rule's notification title isolates
 * the target's name (W3-5).
 */
const ADMIN = "11111111-1111-1111-1111-111111111111"; // the fixtures' user — the actor
const BOB = "11111111-1111-1111-1111-1111111111b2"; // routed to every event here
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
  listAccounts: vi.fn(async () => [{ id: ACCOUNT_A, name: "Account A", slug: "a", statusWindowHours: 24 }]),
  listAllAccounts: vi.fn(async () => [{ id: ACCOUNT_A, name: "Account A", slug: "a", statusWindowHours: 24 }]),
  allowedAccountsForUser: vi.fn(async () => [{ id: ACCOUNT_A, name: "Account A", slug: "a", statusWindowHours: 24 }]),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaigns,
  notificationRoutes,
  notifications,
  storeOrderFields,
  userAccounts,
  users,
} from "@/db/schema";
import { coreFieldRows, systemRequiredFieldRows } from "@/store/fields";
import { EVENT_TYPE_KEYS } from "@/lib/notifications";
import { rollbackBatch } from "@/app/actions/rollback";
import { commitStoreUpload, rollbackStoreBatch } from "@/app/actions/store-upload";
import { createExclusionRule } from "@/app/actions/exclusion-rules";
import { CAMPAIGN_1, resetAndSeed } from "./fixtures";

const BATCH_A = "55555555-5555-5555-5555-555555555001";

beforeEach(async () => {
  await resetAndSeed();
  await db.insert(users).values({ id: BOB, email: "bob@test.local", name: "Bob", role: "editor" });
  await db.insert(userAccounts).values({ userId: BOB, accountId: ACCOUNT_A });
  await db.insert(notificationRoutes).values(
    EVENT_TYPE_KEYS.map((eventType) => ({ accountId: ACCOUNT_A, eventType, userId: BOB })),
  );
});

const titlesFor = async (type: string) =>
  (await db.select().from(notifications).where(eq(notifications.type, type))).map((n) => ({
    to: n.recipientUserId,
    title: n.title,
    href: n.href,
  }));

describe("a Store rollback notifies like the ads rollback (D30)", () => {
  it("the routed member hears it, in the same words, with the count removed", async () => {
    await db.delete(storeOrderFields).where(eq(storeOrderFields.accountId, ACCOUNT_A));
    await db.insert(storeOrderFields).values([
      ...coreFieldRows(ACCOUNT_A).map((r) => ({
        ...r,
        headers: ({ order_id: ["order id"], order_date: ["order date"], total_amount: ["total"] } as Record<string, string[]>)[r.key] ?? [],
      })),
      ...systemRequiredFieldRows(ACCOUNT_A),
    ]);
    const fd = new FormData();
    fd.set("file", new File(["Order ID,Order date,Total,utm_source,channel\nR1,2026-01-01,10,,\nR2,2026-01-01,12,,\n"], "o.csv", { type: "text/csv" }));
    fd.set("upsert", "false");
    const c = await commitStoreUpload(fd);
    expect(c.ok).toBe(true);
    if (!c.ok) return;

    const res = await rollbackStoreBatch(c.batchId);
    expect(res).toEqual({ ok: true, removed: 2 });
    expect(await titlesFor("store.upload_rolled_back")).toEqual([
      { to: BOB, title: "Store upload rolled back: 2 orders removed", href: "/store/uploads" },
    ]);
  });

  it("the ads rollback reports what it removed, worded the same way", async () => {
    const res = await rollbackBatch(BATCH_A);
    expect(res.ok).toBe(true);
    expect(res.removed).toBeGreaterThan(0);
    const [n] = await titlesFor("upload.rolled_back");
    expect(n!.title).toBe(`Upload rolled back: ${res.removed} rows removed`);
  });
});

describe("an exclusion rule's notification isolates the target's name (W3-5)", () => {
  it("an Arabic campaign name cannot reorder the English title", async () => {
    await db.update(campaigns).set({ name: "حملة الصيف ➤ واسع (IG)" }).where(eq(campaigns.id, CAMPAIGN_1));
    const res = await createExclusionRule({ target: { kind: "campaign", campaignId: CAMPAIGN_1 } });
    expect(res.ok).toBe(true);
    const [n] = await titlesFor("exclusion.rule_created");
    expect(n!.title).toBe("Exclusion rule added: campaign “⁨حملة الصيف ➤ واسع (IG)⁩”");
  });
});
