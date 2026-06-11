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
  creativeTags,
  tags,
  ratingRules,
  platformFieldMappings,
  uploadBatches,
  performanceRecords,
  DEFAULT_ACCOUNT_ID,
  type platformEnum,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth-password";
import { instagramAdapter } from "@/csv/platforms/instagram";
import { facebookAdapter } from "@/csv/platforms/facebook";
import { tiktokAdapter } from "@/csv/platforms/tiktok";
import { snapchatAdapter } from "@/csv/platforms/snapchat";
import type { InternalField } from "@/csv/platforms/types";
import { sql } from "drizzle-orm";
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
      .onConflictDoNothing({ target: products.slug });
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
        target: creatives.name,
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
  const adapters = [instagramAdapter, facebookAdapter, tiktokAdapter, snapchatAdapter];
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

  // ---------- Tags ----------
  const tagAssignments: Array<{ creativeName: string; tag: string }> = [
    { creativeName: "URJ_VID_001", tag: "launch" },
    { creativeName: "URJ_VID_001", tag: "ugc" },
    { creativeName: "URJ_VID_002", tag: "ugc" },
    { creativeName: "URJ_VID_002", tag: "cold-traffic" },
    { creativeName: "URJ_IMG_010", tag: "evergreen" },
    { creativeName: "URJ_SLD_020", tag: "evergreen" },
    { creativeName: "URJ_SLD_020", tag: "retargeting" },
  ];
  for (const t of tagAssignments) {
    const cid = creativeByName.get(t.creativeName);
    if (!cid) continue;
    await db
      .insert(creativeTags)
      .values({ creativeId: cid, tag: t.tag })
      .onConflictDoNothing();
  }
  console.log("  tag assignments:", tagAssignments.length);

  // ---------- Tag vocabulary (backfill from assignments) ----------
  // Seed the managed vocabulary from whatever tags are in use so the
  // Catalog → Tags admin starts populated. Idempotent.
  const distinctTags = [...new Set(tagAssignments.map((t) => t.tag))];
  for (const name of distinctTags) {
    await db
      .insert(tags)
      .values({ name, createdByUserId: adminId })
      .onConflictDoNothing({ target: tags.name });
  }
  console.log("  tag vocabulary:", distinctTags.length);

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

  for (const c of creativeList) {
    for (const platform of platforms) {
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
          campaignName: buildCampaignName("Always-On", "Broad", platform),
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
      .onConflictDoNothing({
        target: [
          performanceRecords.creativeId,
          performanceRecords.platform,
          performanceRecords.campaignName,
          performanceRecords.date,
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

  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
