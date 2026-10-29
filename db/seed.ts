/**
 * Idempotent dev seed.
 *
 * Inserts one admin user, three products, four creatives, one upload batch,
 * and ~60 performance records spanning the last 30 days across two platforms.
 *
 * Re-running is safe: every insert uses ON CONFLICT DO NOTHING on the
 * relevant unique constraint, and performance_records is keyed by
 * (creative_id, platform, date) so identical rows are skipped.
 *
 * Run with: npm run db:seed
 */
import { db } from "@/lib/db";
import {
  users,
  products,
  creatives,
  creativeAngles,
  angles,
  ratingRules,
  platformFieldMappings,
  campaigns,
  landingPages,
  uploadBatches,
  performanceRecords,
  storeOrders,
  storeSourceMappings,
  storeChannelMappings,
  DEFAULT_ACCOUNT_ID,
  type platformEnum,
} from "@/db/schema";
import { writeStoreBatch, type StoreWriteRow } from "@/db/queries/store";
import { hashPassword } from "@/lib/auth-password";
import { ADAPTERS } from "@/csv/platforms";
import type { InternalField } from "@/csv/platforms/types";
import { eq, sql } from "drizzle-orm";
import { buildCampaignName } from "@/lib/campaign";

type Platform = (typeof platformEnum)[number];

async function main() {
  console.log("Seeding…");

  // ---------- User ----------
  // Default admin credentials (dev only):
  //   email:    salam@urjwan.com
  //   password: urjwan-dev-2026
  // The password is rehashed on every seed run so re-running can repair a
  // forgotten password without dropping the user row.
  const ADMIN_EMAIL = "salam@urjwan.com";
  const ADMIN_PASSWORD = "urjwan-dev-2026";
  const adminHash = await hashPassword(ADMIN_PASSWORD);

  const [admin] = await db
    .insert(users)
    .values({
      email: ADMIN_EMAIL,
      name: "Salam (seed admin)",
      role: "admin",
      passwordHash: adminHash,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: { passwordHash: adminHash },
    })
    .returning();

  const adminId =
    admin?.id ??
    (
      await db
        .select({ id: users.id })
        .from(users)
        .where(sql`${users.email} = ${ADMIN_EMAIL}`)
    )[0]!.id;

  console.log("  user:", adminId, `(${ADMIN_EMAIL} / ${ADMIN_PASSWORD})`);

  // ---------- Products ----------
  const productRows = [
    { name: "Argan Oil", slug: "argan-oil" },
    { name: "Rose Toner", slug: "rose-toner" },
    { name: "Saffron Cream", slug: "saffron-cream" },
  ];
  for (const p of productRows) {
    await db
      .insert(products)
      .values({ ...p, createdByUserId: adminId })
      .onConflictDoNothing({ target: [products.accountId, products.slug] });
  }
  const productList = await db
    .select({ id: products.id, slug: products.slug })
    .from(products);
  const productBySlug = new Map(productList.map((p) => [p.slug, p.id]));
  console.log("  products:", productList.length);

  // ---------- Creatives ----------
  // Launch dates are spread across the trailing seed window so the Trends
  // "Launches" cohort view has data in each creative's first-7 / first-30
  // day windows.
  const isoDaysAgo = (n: number): string => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const creativeRows = [
    {
      name: "URJ_VID_001",
      productSlug: "argan-oil",
      type: "video" as const,
      status: "active" as const,
      launchDate: isoDaysAgo(45),
    },
    {
      name: "URJ_VID_002",
      productSlug: "argan-oil",
      type: "video" as const,
      status: "active" as const,
      launchDate: isoDaysAgo(38),
    },
    {
      name: "URJ_IMG_010",
      productSlug: "rose-toner",
      type: "image" as const,
      status: "active" as const,
      launchDate: isoDaysAgo(20),
    },
    {
      name: "URJ_SLD_020",
      productSlug: "saffron-cream",
      type: "slides" as const,
      status: "paused" as const,
      launchDate: isoDaysAgo(10),
    },
  ];
  for (const c of creativeRows) {
    await db
      .insert(creatives)
      .values({
        name: c.name,
        productId: productBySlug.get(c.productSlug)!,
        type: c.type,
        status: c.status,
        launchDate: c.launchDate,
        createdByUserId: adminId,
      })
      // Re-runs refresh the launch date (the column was added after the
      // initial seed) without disturbing other fields.
      .onConflictDoUpdate({
        target: [creatives.accountId, creatives.name],
        set: { launchDate: c.launchDate },
      });
  }
  const creativeList = await db
    .select({ id: creatives.id, name: creatives.name })
    .from(creatives);
  const creativeByName = new Map(creativeList.map((c) => [c.name, c.id]));
  console.log("  creatives:", creativeList.length);

  // ---------- Platform header mappings (idempotent backfill) ----------
  // Seeds the placeholder candidate headers we shipped in code into the DB
  // so the admin UI starts with reasonable defaults. Each (platform, field,
  // header) is unique; ON CONFLICT DO NOTHING keeps re-runs no-ops.
  // Derived from the adapter registry — a new platform seeds its defaults too.
  const adapters = Object.values(ADAPTERS);
  let mappingsInserted = 0;
  for (const a of adapters) {
    for (const [field, headers] of Object.entries(a.headerMap) as Array<[
      InternalField,
      string[],
    ]>) {
      for (let i = 0; i < headers.length; i++) {
        const r = await db
          .insert(platformFieldMappings)
          .values({
            platform: a.platform,
            internalField: field,
            headerName: headers[i]!,
            priority: i,
            createdByUserId: adminId,
          })
          .onConflictDoNothing({
            target: [
              platformFieldMappings.accountId,
              platformFieldMappings.platform,
              platformFieldMappings.internalField,
              platformFieldMappings.headerName,
            ],
          })
          .returning({ id: platformFieldMappings.id });
        mappingsInserted += r.length;
      }
    }
  }
  console.log("  platform field mappings:", mappingsInserted, "inserted");

  // ---------- Angles ----------
  const angleAssignments: Array<{ creativeName: string; angle: string }> = [
    { creativeName: "URJ_VID_001", angle: "launch" },
    { creativeName: "URJ_VID_001", angle: "ugc" },
    { creativeName: "URJ_VID_002", angle: "ugc" },
    { creativeName: "URJ_VID_002", angle: "cold-traffic" },
    { creativeName: "URJ_IMG_010", angle: "evergreen" },
    { creativeName: "URJ_SLD_020", angle: "evergreen" },
    { creativeName: "URJ_SLD_020", angle: "retargeting" },
  ];
  for (const t of angleAssignments) {
    const cid = creativeByName.get(t.creativeName);
    if (!cid) continue;
    await db
      .insert(creativeAngles)
      .values({ creativeId: cid, angle: t.angle })
      .onConflictDoNothing();
  }
  console.log("  angle assignments:", angleAssignments.length);

  // ---------- Angle vocabulary (backfill from assignments) ----------
  // Seed the managed vocabulary from whatever angles are in use so the
  // Catalog → Angles admin starts populated. Idempotent.
  const distinctAngles = [...new Set(angleAssignments.map((t) => t.angle))];
  for (const name of distinctAngles) {
    await db
      .insert(angles)
      .values({ name, createdByUserId: adminId })
      .onConflictDoNothing({ target: [angles.accountId, angles.name] });
  }
  console.log("  angle vocabulary:", distinctAngles.length);

  // ---------- Landing pages ----------
  // Two registered pages so Trends → LPs has real rows beside the product
  // page. A share of two creatives' daily traffic is written under them below
  // (the equivalent of ads named `URJ_VID_002 @ramadan`), unique on
  // (account, code) so re-runs are no-ops.
  // Each page sells one product — the product of the creative split to it
  // below, as the upload rule (E024) would demand.
  const landingPageRows = [
    { name: "Ramadan offer", code: "ramadan", url: "https://urjwan.com/ramadan", productSlug: "argan-oil" },
    { name: "Bundle page", code: "bundle", url: "https://urjwan.com/bundle", productSlug: "rose-toner" },
  ];
  for (const { productSlug, ...lp } of landingPageRows) {
    const productId = productBySlug.get(productSlug)!;
    await db
      .insert(landingPages)
      .values({ ...lp, productId, createdByUserId: adminId })
      // A page seeded before products joined the registry picks its product up
      // on the next run; everything else about it is left alone.
      .onConflictDoUpdate({
        target: [landingPages.accountId, landingPages.code],
        set: { productId: sql`COALESCE(${landingPages.productId}, ${productId})` },
      });
  }
  const landingPageList = await db
    .select({ id: landingPages.id, code: landingPages.code })
    .from(landingPages);
  const landingPageIdByCode = new Map(landingPageList.map((l) => [l.code, l.id]));
  console.log("  landing pages:", landingPageList.length);
  /** Which creatives split traffic to a landing page: the page, the share of
   *  the day's numbers that goes there, how many recent days, and how much
   *  better (or worse) the page converts than the product page. */
  const LANDING_SPLIT: Record<string, { code: string; share: number; days: number; cvrBoost: number }> = {
    URJ_VID_002: { code: "ramadan", share: 0.4, days: 25, cvrBoost: 1.6 },
    URJ_IMG_010: { code: "bundle", share: 0.3, days: 45, cvrBoost: 0.7 },
  };

  // ---------- Upload batch + performance records ----------
  // One synthetic batch covering both platforms over the last 30 days.
  const [batch] = await db
    .insert(uploadBatches)
    .values({
      platform: "instagram",
      fileName: "seed_synthetic.csv",
      uploadedByUserId: adminId,
      rowsImported: 0,
    })
    .returning();
  const batchId = batch!.id;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  type PerfRow = typeof performanceRecords.$inferInsert;
  const rows: PerfRow[] = [];
  const platforms: Platform[] = ["instagram", "facebook"];

  // Each creative gets ~60 daily rows on each of two platforms so both the
  // current-30d window and the prior-30d window have data — required for
  // Trends / Over-time period-over-period deltas to render meaningfully.
  // A gentle multiplier ramps spend up over time so the deltas trend
  // positive in the demo (CTR/CPA wobble a little around their base).
  let seedRng = 1;
  const rand = () => {
    // Tiny deterministic LCG so re-runs produce identical numbers and the
    // ON CONFLICT path skips them cleanly.
    seedRng = (seedRng * 1103515245 + 12345) & 0x7fffffff;
    return seedRng / 0x7fffffff;
  };

  const SEED_DAYS = 60;

  // Register the seed campaigns (one per platform) so performance rows carry a
  // campaign_id FK, mirroring the real upload path. Default account (Urjwan).
  const campaignIdByName = new Map<string, string>();
  for (const platform of platforms) {
    const name = buildCampaignName("Always-On", "Broad", platform);
    const [campRow] = await db
      .insert(campaigns)
      .values({ name, platform, objective: "Sales", createdByUserId: adminId })
      .onConflictDoNothing({ target: [campaigns.accountId, campaigns.name] })
      .returning({ id: campaigns.id });
    let campId = campRow?.id;
    if (!campId) {
      const [existing] = await db
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(eq(campaigns.name, name))
        .limit(1);
      campId = existing!.id;
    }
    campaignIdByName.set(name, campId);
  }

  for (const c of creativeList) {
    for (const platform of platforms) {
      const campaignName = buildCampaignName("Always-On", "Broad", platform);
      const campaignId = campaignIdByName.get(campaignName)!;
      for (let d = 0; d < SEED_DAYS; d++) {
        const date = new Date(today);
        date.setUTCDate(date.getUTCDate() - d);
        const dateStr = date.toISOString().slice(0, 10);

        // Ramp: most-recent day is 1.0x, oldest day is ~0.72x. Gives a
        // positive delta on spend/impressions/conversions between the
        // current and prior 30d windows.
        const ramp = 1 - (d / SEED_DAYS) * 0.28;

        const impressions = Math.floor((2_000 + rand() * 18_000) * ramp);
        const ctrPct = 0.005 + rand() * 0.04; // 0.5% – 4.5%
        const clicks = Math.max(1, Math.floor(impressions * ctrPct));
        const cpmDollars = 2 + rand() * 8;
        const spend = +((impressions / 1000) * cpmDollars).toFixed(2);
        const conversions = Math.max(0, Math.floor(clicks * (0.01 + rand() * 0.08)));
        const conversionValue = +(conversions * (15 + rand() * 60)).toFixed(2);
        const vv2s = Math.floor(impressions * (0.2 + rand() * 0.3));
        const vv25 = Math.floor(vv2s * (0.6 + rand() * 0.3));
        const vv50 = Math.floor(vv2s * (0.4 + rand() * 0.3));
        const vv75 = Math.floor(vv2s * (0.2 + rand() * 0.3));
        const vv100 = Math.floor(vv2s * (0.1 + rand() * 0.2));
        const lpv = Math.floor(clicks * (0.6 + rand() * 0.4));

        rows.push({
          creativeId: c.id,
          platform,
          campaignId,
          date: dateStr,
          spend: spend.toString(),
          impressions,
          clicks,
          conversions,
          conversionValue: conversionValue.toString(),
          landingPageViews: lpv,
          videoViews2s: vv2s,
          videoViews25: vv25,
          videoViews50: vv50,
          videoViews75: vv75,
          videoViews100: vv100,
          rawPayload: { source: "seed", note: "synthetic" },
          uploadBatchId: batchId,
        });

        // A second row for the same day under a landing page — the record
        // identity includes landing_page_id, so both rows coexist.
        const split = LANDING_SPLIT[c.name];
        const landingPageId = split ? landingPageIdByCode.get(split.code) : undefined;
        if (split && landingPageId && d < split.days) {
          const k = split.share;
          const lpConversions = Math.floor(conversions * k * split.cvrBoost);
          rows.push({
            creativeId: c.id,
            platform,
            campaignId,
            date: dateStr,
            landingPageId,
            spend: (spend * k).toFixed(2),
            impressions: Math.floor(impressions * k),
            clicks: Math.max(1, Math.floor(clicks * k)),
            conversions: lpConversions,
            conversionValue: (lpConversions * (15 + rand() * 60)).toFixed(2),
            landingPageViews: Math.floor(lpv * k),
            videoViews2s: Math.floor(vv2s * k),
            videoViews25: Math.floor(vv25 * k),
            videoViews50: Math.floor(vv50 * k),
            videoViews75: Math.floor(vv75 * k),
            videoViews100: Math.floor(vv100 * k),
            rawPayload: { source: "seed", note: "synthetic", landingPage: split.code },
            uploadBatchId: batchId,
          });
        }
      }
    }
  }

  // Bulk insert in chunks. ON CONFLICT on the unique (creative_id, platform,
  // date) index means re-runs are no-ops.
  let inserted = 0;
  const chunkSize = 100;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const result = await db
      .insert(performanceRecords)
      .values(chunk)
      // The identity is the FULL `perf_identity_uq` (…, landing_page_id, NULLS
      // NOT DISTINCT) — a shorter target matches no constraint (42P10).
      .onConflictDoNothing({
        target: [
          performanceRecords.creativeId,
          performanceRecords.platform,
          performanceRecords.campaignId,
          performanceRecords.date,
          performanceRecords.landingPageId,
        ],
      })
      .returning({ id: performanceRecords.id });
    inserted += result.length;
  }

  await db
    .update(uploadBatches)
    .set({ rowsImported: inserted })
    .where(sql`${uploadBatches.id} = ${batchId}`);

  console.log(
    `  performance_records: ${inserted} inserted (of ${rows.length} candidates)`,
  );

  // Rating rules — singleton config (id = 1) driving the /summary Rate column.
  // Tuned to the synthetic data (ROAS ~6–10×) so the demo shows a real spread
  // of Good / Decent / Bad; Snapchat has no seeded data so it renders N/A.
  // (The schema column defaults stay at the generic 4× / 2× for real use.)
  await db
    .insert(ratingRules)
    .values({
      accountId: DEFAULT_ACCOUNT_ID,
      minSpend: "500",
      goodRoas: "9",
      decentRoas: "7",
    })
    .onConflictDoNothing({ target: ratingRules.accountId });
  console.log("  rating rules: default-account row ensured");

  await seedStore(adminId);

  console.log("Done.");
}

/**
 * Store module demo data: the two explicit mappings and ~90 days of
 * UTM-tagged orders ending today, so /store/utms, /store/insights and
 * /store/reconciliation all have something to show against the synthetic ads
 * rows above. Several raw values map to ONE platform on purpose (`instagram`
 * + `ig`), two values are left UNMAPPED on purpose (`Instagram`, `fb_ads` —
 * the hygiene section demos them), and a share of orders carries no UTM.
 * Idempotent: mappings upsert-nothing, and the order batch is skipped once
 * its `SEED-` ids exist.
 */
async function seedStore(adminId: string) {
  const sourceMappings: Array<{ rawValue: string; platform: Platform | null }> = [
    { rawValue: "instagram", platform: "instagram" },
    { rawValue: "ig", platform: "instagram" },
    { rawValue: "facebook", platform: "facebook" },
    { rawValue: "snapchat", platform: "snapchat" },
    { rawValue: "tiktok", platform: "tiktok" },
    { rawValue: "google", platform: "google" },
    { rawValue: "whatsapp", platform: null },
    { rawValue: "direct", platform: null },
    { rawValue: "email", platform: null },
  ];
  for (const m of sourceMappings) {
    await db
      .insert(storeSourceMappings)
      .values({ accountId: DEFAULT_ACCOUNT_ID, ...m })
      .onConflictDoNothing();
  }
  for (const c of [
    { rawValue: "web", destination: "website" },
    { rawValue: "app", destination: "application" },
  ]) {
    await db
      .insert(storeChannelMappings)
      .values({ accountId: DEFAULT_ACCOUNT_ID, ...c })
      .onConflictDoNothing();
  }
  console.log("  store mappings: ensured");

  const [existing] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(storeOrders)
    .where(
      sql`${storeOrders.accountId} = ${DEFAULT_ACCOUNT_ID} AND ${storeOrders.orderId} LIKE 'SEED-%'`,
    );
  if (Number(existing?.n ?? 0) > 0) {
    console.log("  store orders: seed batch already present");
    return;
  }

  // Source mix, in percent. Blank = no UTM at all.
  const mix: Array<[string, number]> = [
    ["instagram", 30],
    ["facebook", 18],
    ["snapchat", 12],
    ["tiktok", 8],
    ["google", 5],
    ["ig", 4],
    ["Instagram", 2],
    ["fb_ads", 1],
    ["whatsapp", 5],
    ["direct", 6],
    ["email", 2],
    ["", 7],
  ];
  const mixTotal = mix.reduce((a, [, w]) => a + w, 0);
  let rng = 7;
  const rand = () => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return rng / 0x7fffffff;
  };
  const pickSource = () => {
    let r = rand() * mixTotal;
    for (const [value, w] of mix) {
      if (r < w) return value;
      r -= w;
    }
    return "";
  };

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const rows: StoreWriteRow[] = [];
  let n = 0;
  for (let d = 89; d >= 0; d--) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - d);
    const orderDate = date.toISOString().slice(0, 10);
    const perDay = 6 + Math.floor(rand() * 9);
    for (let i = 0; i < perDay; i++) {
      n += 1;
      rows.push({
        orderId: `SEED-${String(n).padStart(5, "0")}`,
        orderDate,
        totalAmount: (80 + rand() * 520).toFixed(2),
        attributes: {
          utm_source: pickSource(),
          channel: rand() < 0.72 ? "web" : "app",
        },
      });
    }
  }
  await writeStoreBatch({
    accountId: DEFAULT_ACCOUNT_ID,
    fileName: "seed_store_orders.csv",
    uploadedByUserId: adminId,
    upsert: false,
    inserts: rows,
    updates: [],
  });
  console.log(`  store orders: ${rows.length} inserted`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
