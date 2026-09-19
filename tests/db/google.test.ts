import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

const USER = "11111111-1111-1111-1111-111111111111"; // seeded by the fixtures

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

// Only the auth boundary is faked — the guards under test run for real.
vi.mock("@/lib/auth", () => ({
  requirePermission: vi.fn(async () => ({ id: USER, role: "admin" })),
  auth: vi.fn(async () => ({ id: USER, role: "admin" })),
  can: vi.fn(() => true),
}));

import { getActiveAccountId } from "@/lib/tenant";
import { db } from "@/lib/db";
import {
  campaigns,
  creatives,
  performanceRecords,
  products,
  uploadBatches,
} from "@/db/schema";
import { ensureGoogleCreative } from "@/db/queries/google";
import { funnelOverview } from "@/db/queries/funnel";
import { deleteCreative, patchCreative } from "@/app/actions/creative";
import {
  GOOGLE_SYSTEM_CREATIVE_NAME,
  GOOGLE_SYSTEM_PRODUCT_NAME,
} from "@/lib/google";
import { resetAndSeed, CREATIVE_1, PRODUCT_A } from "./fixtures";

const setAccount = (id: string) => vi.mocked(getActiveAccountId).mockResolvedValue(id);

const GOOGLE_CAMPAIGN = "44444444-4444-4444-4444-44444444a0f1";
const GOOGLE_BATCH = "55555555-5555-5555-5555-55555555a0f1";

beforeAll(async () => {
  await resetAndSeed();
});
beforeEach(() => setAccount(ACCOUNT_A));

describe("ensureGoogleCreative", () => {
  it("creates the system creative once, then finds it (idempotent)", async () => {
    const first = await ensureGoogleCreative(db, ACCOUNT_A, USER);
    const second = await ensureGoogleCreative(db, ACCOUNT_A, USER);
    expect(second).toBe(first);

    const rows = await db
      .select()
      .from(creatives)
      .where(
        and(
          eq(creatives.accountId, ACCOUNT_A),
          eq(creatives.name, GOOGLE_SYSTEM_CREATIVE_NAME),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.isSystem).toBe(true);
    expect(rows[0]!.type).toBe("image");
  });

  it("CREATES the Collection product when the brand hasn't got one", async () => {
    // Account A's fixtures only have "Product A", so this is the create path.
    const id = await ensureGoogleCreative(db, ACCOUNT_A, USER);
    const [row] = await db
      .select({ productId: creatives.productId })
      .from(creatives)
      .where(eq(creatives.id, id));
    const [product] = await db
      .select({ name: products.name })
      .from(products)
      .where(eq(products.id, row!.productId));
    expect(product!.name).toBe(GOOGLE_SYSTEM_PRODUCT_NAME);
  });

  it("matches an EXISTING Collection product case-insensitively", async () => {
    // Account B gets a differently-cased one; the helper must reuse it rather
    // than creating a second product that only differs in case.
    await db.insert(products).values({
      accountId: ACCOUNT_B,
      name: "collection",
      slug: "collection-b",
      createdByUserId: USER,
    });
    const id = await ensureGoogleCreative(db, ACCOUNT_B, USER);
    const [row] = await db
      .select({ productId: creatives.productId })
      .from(creatives)
      .where(eq(creatives.id, id));
    const [product] = await db
      .select({ name: products.name })
      .from(products)
      .where(eq(products.id, row!.productId));
    expect(product!.name).toBe("collection");

    const all = await db
      .select({ name: products.name })
      .from(products)
      .where(eq(products.accountId, ACCOUNT_B));
    expect(all.filter((p) => p.name.toLowerCase() === "collection")).toHaveLength(1);
  });

  it("is account-scoped — each brand gets its OWN system creative", async () => {
    const a = await ensureGoogleCreative(db, ACCOUNT_A, USER);
    const b = await ensureGoogleCreative(db, ACCOUNT_B, USER);
    expect(a).not.toBe(b);
  });
});

describe("system-creative guards", () => {
  it("REFUSES a rename — uploads resolve it by name", async () => {
    const id = await ensureGoogleCreative(db, ACCOUNT_A, USER);
    const res = await patchCreative({ id, name: "Anything Else" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/system creative/i);

    const [row] = await db
      .select({ name: creatives.name })
      .from(creatives)
      .where(eq(creatives.id, id));
    expect(row!.name).toBe(GOOGLE_SYSTEM_CREATIVE_NAME);
  });

  it("ALLOWS the harmless edits (priority, stage, thumbnail, product)", async () => {
    const id = await ensureGoogleCreative(db, ACCOUNT_A, USER);
    const res = await patchCreative({
      id,
      priority: 3,
      stages: ["Awareness"],
      thumbnailUrl: "https://blob.example/g.webp",
      productId: PRODUCT_A,
    });
    expect(res.ok).toBe(true);
    const [row] = await db
      .select({
        priority: creatives.priority,
        stages: creatives.stages,
        thumbnailUrl: creatives.thumbnailUrl,
        productId: creatives.productId,
      })
      .from(creatives)
      .where(eq(creatives.id, id));
    expect(row!.priority).toBe(3);
    expect(row!.stages).toEqual(["Awareness"]);
    expect(row!.thumbnailUrl).toBe("https://blob.example/g.webp");
    expect(row!.productId).toBe(PRODUCT_A);
  });

  it("REFUSES a delete — every google record hangs off it", async () => {
    const id = await ensureGoogleCreative(db, ACCOUNT_A, USER);
    const res = await deleteCreative(id);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/system creative/i);

    const rows = await db.select().from(creatives).where(eq(creatives.id, id));
    expect(rows).toHaveLength(1);
  });

  it("an ORDINARY creative is still renamable and deletable", async () => {
    const res = await patchCreative({ id: CREATIVE_1, name: "A-Creative-1-renamed" });
    expect(res.ok).toBe(true);
    await patchCreative({ id: CREATIVE_1, name: "A-Creative-1" });
  });
});

/**
 * THE RATIO-POISONING TRAP, against the real query.
 *
 * Google reports conversions but has no add-payment events at all. Without the
 * guard, the blended purchase rate takes its numerator from every platform and
 * its denominator from only the platforms that measure it — and reads far
 * higher than any real platform's rate.
 */
describe("blended funnel rates with google in the data", () => {
  const FROM = "2026-03-01";
  const TO = "2026-03-31";

  beforeAll(async () => {
    await db.insert(campaigns).values({
      id: GOOGLE_CAMPAIGN,
      accountId: ACCOUNT_A,
      name: "Search Brand ➤ All",
      platform: "google",
      objective: "Sales",
      createdByUserId: USER,
    });
    await db.insert(uploadBatches).values({
      id: GOOGLE_BATCH,
      accountId: ACCOUNT_A,
      platform: "google",
      fileName: "g.csv",
      uploadedByUserId: USER,
      rowsImported: 2,
    });
    await db.insert(performanceRecords).values([
      // instagram: a full funnel — 100 LP views → 50 ATC → 40 AP → 10 purchases.
      {
        accountId: ACCOUNT_A,
        creativeId: CREATIVE_1,
        platform: "instagram",
        date: "2026-03-10",
        campaignId: GOOGLE_CAMPAIGN,
        spend: "100",
        impressions: 1000,
        clicks: 200,
        conversions: 10,
        conversionValue: "500",
        landingPageViews: 100,
        addToCart: 50,
        addPayment: 40,
        rawPayload: {},
        uploadBatchId: GOOGLE_BATCH,
      },
      // google: conversions only — the mid-funnel columns are NULL, because
      // google never reported them (the pipeline refuses to write 0 there).
      {
        accountId: ACCOUNT_A,
        creativeId: CREATIVE_1,
        platform: "google",
        date: "2026-03-10",
        campaignId: GOOGLE_CAMPAIGN,
        spend: "200",
        impressions: 5000,
        clicks: 300,
        conversions: 90,
        conversionValue: "4500",
        landingPageViews: null,
        addToCart: null,
        addPayment: null,
        rawPayload: {},
        uploadBatchId: GOOGLE_BATCH,
      },
    ]);
  });

  it("purchaseRate is instagram's OWN rate, not the poisoned blend", async () => {
    const { current } = await funnelOverview({ from: FROM, to: TO });
    // Instagram alone: 10 purchases / 40 add-payments = 25%.
    expect(current.purchaseRate).toBeCloseTo(0.25, 9);
    // The bug this guards against: (10 + 90) / 40 = 250%, a rate that claims
    // more purchases than there were add-payments. If this ever passes, the
    // guard in lib/metrics.ts has been removed.
    expect(current.purchaseRate).not.toBeCloseTo(2.5, 6);
  });

  it("the other poisoned rates are clean too (cvr / voc / atc / ap)", async () => {
    const { current } = await funnelOverview({ from: FROM, to: TO });
    expect(current.cvr).toBeCloseTo(10 / 100, 9); // NOT (10+90)/100
    expect(current.voc).toBeCloseTo(100 / 200, 9); // NOT 100/(200+300)
    expect(current.atcRate).toBeCloseTo(50 / 100, 9);
    expect(current.apRate).toBeCloseTo(40 / 50, 9);
  });

  it("plain totals and google-supported ratios still INCLUDE google", async () => {
    const { current } = await funnelOverview({ from: FROM, to: TO });
    expect(current.spend).toBe(300); // 100 + 200
    expect(current.impressions).toBe(6000);
    expect(current.clicks).toBe(500);
    expect(current.conversions).toBe(100); // 10 + 90
    expect(current.ctr).toBeCloseTo(500 / 6000, 9);
    expect(current.cpm).toBeCloseTo((300 / 6000) * 1000, 9);
  });
});
