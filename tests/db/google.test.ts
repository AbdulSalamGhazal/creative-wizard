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
import { campaignFunnel, funnelOverview } from "@/db/queries/funnel";
import { kpis, compareDimensions } from "@/db/queries/performance";
import { listCreativeSummary } from "@/db/queries/summary";
import { listCreatives } from "@/db/queries/creatives";
import { deleteCreative, patchCreative } from "@/app/actions/creative";
import {
  GOOGLE_SYSTEM_CREATIVE_NAME,
  GOOGLE_SYSTEM_PRODUCT_NAME,
} from "@/lib/google";
import { resetAndSeed, CREATIVE_1, PRODUCT_A } from "./fixtures";

const setAccount = (id: string) => vi.mocked(getActiveAccountId).mockResolvedValue(id);

const GOOGLE_CAMPAIGN = "44444444-4444-4444-4444-44444444a0f1";
let systemCreativeId = "";
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
 * THE RATIO-POISONING TRAP, against the real queries.
 *
 * Google reports conversions but has no add-payment events at all. Two layers
 * protect the numbers, and both are pinned below:
 *   - phase 1, the SQL guard: on a BRAND-level query (kpis), google's rows are
 *     counted in the totals but excluded from BOTH sides of any rate it can't
 *     report;
 *   - phase 2, the surface rule: on the FUNNEL surfaces google isn't there at
 *     all, so its spend and conversions don't appear either.
 */
describe("blended funnel rates with google in the data", () => {
  const FROM = "2026-03-01";
  const TO = "2026-03-31";

  beforeAll(async () => {
    // As in production: google's rows hang off the ONE system creative.
    systemCreativeId = await ensureGoogleCreative(db, ACCOUNT_A, USER);
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
        creativeId: systemCreativeId,
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

  // ---- phase 1: the SQL guard, on a brand-level query that KEEPS google ----
  it("brand-level rates exclude google from both sides, totals keep it", async () => {
    const k = await kpis({ from: FROM, to: TO });
    // Totals: google's spend and conversions are real brand numbers.
    expect(k.spend).toBe(300); // 100 + 200
    expect(k.impressions).toBe(6000);
    expect(k.clicks).toBe(500);
    expect(k.conversions).toBe(100); // 10 + 90
    // Ratios google fully reports keep it in.
    expect(k.ctr).toBeCloseTo(500 / 6000, 9);
    expect(k.cpm).toBeCloseTo((300 / 6000) * 1000, 9);
    // Ratios it can't back are instagram's own — NOT the poisoned blend.
    expect(k.cvr).toBeCloseTo(10 / 100, 9); // NOT (10+90)/100
    expect(k.voc).toBeCloseTo(100 / 200, 9); // NOT 100/(200+300)
  });

  it("the funnel card's CPM/CTR are the google-free pair", async () => {
    const k = await kpis({ from: FROM, to: TO });
    // The card must tell ONE story, so its CPM/CTR drop google too — unlike
    // the brand-level cpm/ctr above, which are every platform's.
    expect(k.funnelCtr).toBeCloseTo(200 / 1000, 9);
    expect(k.funnelCpm).toBeCloseTo((100 / 1000) * 1000, 9);
    expect(k.funnelCtr).not.toBeCloseTo(k.ctr!, 6);
  });

  // ---- phase 2: the funnel surfaces don't show google at all ----
  it("/funnel excludes google ENTIRELY — its conversions never reach CvR", async () => {
    const { current } = await funnelOverview({ from: FROM, to: TO });
    // Instagram's row and nothing else.
    expect(current.spend).toBe(100);
    expect(current.impressions).toBe(1000);
    expect(current.clicks).toBe(200);
    expect(current.conversions).toBe(10); // NOT 100 — google's 90 are not here
    expect(current.ctr).toBeCloseTo(200 / 1000, 9);
  });

  it("every funnel rate is instagram's own", async () => {
    const { current } = await funnelOverview({ from: FROM, to: TO });
    expect(current.purchaseRate).toBeCloseTo(10 / 40, 9);
    // The bug both layers guard against: (10 + 90) / 40 = 250%, a rate that
    // claims more purchases than there were add-payments.
    expect(current.purchaseRate).not.toBeCloseTo(2.5, 6);
    expect(current.cvr).toBeCloseTo(10 / 100, 9);
    expect(current.voc).toBeCloseTo(100 / 200, 9);
    expect(current.atcRate).toBeCloseTo(50 / 100, 9);
    expect(current.apRate).toBeCloseTo(40 / 50, 9);
  });

  it("the per-campaign funnel table gets no Google row", async () => {
    const rows = await campaignFunnel({ from: FROM, to: TO });
    expect(rows.some((r) => r.platform === "google")).toBe(false);
    expect(rows).toHaveLength(1);
  });

  it("a forged ?platforms=google on /funnel yields nothing, not google", async () => {
    const { current } = await funnelOverview({
      from: FROM,
      to: TO,
      platforms: ["google"],
    });
    expect(current.spend).toBe(0);
    expect(current.conversions).toBe(0);
    expect(current.cvr).toBeNull();
  });
});

/**
 * Creative-level surfaces (google, phase 2). Google has no creative concept —
 * its rows all hang off the ONE system creative — so it belongs on none of
 * these. Both guards are checked: the platform set and `creatives.is_system`.
 */
describe("creative-level surfaces exclude google", () => {
  const FROM = "2026-03-01";
  const TO = "2026-03-31";

  it("Ads (the summary query) drops the system creative entirely", async () => {
    const id = await ensureGoogleCreative(db, ACCOUNT_A, USER);
    const all = await listCreativeSummary({ from: FROM, to: TO });
    expect(all.rows.some((r) => r.creativeId === id)).toBe(false);
    expect(all.rows.some((r) => r.name === GOOGLE_SYSTEM_CREATIVE_NAME)).toBe(false);
  });

  it("…and never builds a Google column group, even if one is asked for", async () => {
    const asked = await listCreativeSummary({
      from: FROM,
      to: TO,
      platforms: ["google", "instagram"],
    });
    expect(asked.platforms).toEqual(["instagram"]);
    const onlyGoogle = await listCreativeSummary({
      from: FROM,
      to: TO,
      platforms: ["google"],
    });
    expect(onlyGoogle.platforms).toEqual([]);
  });

  it("Compare's dimension picker offers no google platform or campaign", async () => {
    const dims = await compareDimensions();
    expect(dims.some((d) => d.platform === "google")).toBe(false);
    expect(dims.some((d) => d.creativeName === GOOGLE_SYSTEM_CREATIVE_NAME)).toBe(false);
  });

  it("Library still SHOWS the system creative, badged (unchanged from G1)", async () => {
    const { rows } = await listCreatives({ sort: "name-asc" });
    const sys = rows.find((r) => r.name === GOOGLE_SYSTEM_CREATIVE_NAME);
    expect(sys).toBeDefined();
    expect(sys!.isSystem).toBe(true);
  });
});
