import { beforeAll, describe, expect, it } from "vitest";
import { ACCOUNT_A } from "./config";
import { db } from "@/lib/db";
import { performanceRecords } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { runPipeline } from "@/csv/pipeline";
import { resetAndSeed, CAMPAIGN_1, CREATIVE_1 } from "./fixtures";

/** The seeded account-A batch (fixtures keep it private; the id is stable). */
const BATCH_A = "55555555-5555-5555-5555-555555555001";

/**
 * THE REGRESSION, against real Postgres.
 *
 * A Google P-Max export reported fractional conversions (data-driven
 * attribution splits one conversion across touchpoints) and the commit died on
 * `invalid input syntax for type integer: "11.5"` — 22P02 rolls back the WHOLE
 * transaction, so a 400-row file imported nothing. The count columns are
 * integers by decision, so the pipeline rounds; this test drives the real
 * pipeline's output into the real columns, because a unit assertion about
 * `Number.isInteger` cannot prove what Postgres will accept.
 */
const HEADER =
  "Ad name,Campaign name,Ad set name,Day,Amount spent (USD),Impressions,Link clicks,Results,Purchase value,Landing page views,2-second continuous video plays,Video plays at 25%,Video plays at 50%,Video plays at 75%,Video plays at 100%";

const FRACTIONAL = [
  HEADER,
  // conversions 11.5 → 12, LP views 10.4 → 10, a .5 that rounds up.
  "A-Creative-1,Camp One,Broad,2026-04-01,10.49,1000.5,200,11.5,1234.567,10.4,0,0,0,0,0",
  "A-Creative-1,Camp One,Broad,2026-04-02,10,1000,200,0.5,500,9,0,0,0,0,0",
].join("\n");

beforeAll(async () => {
  await resetAndSeed();
});

describe("fractional counts survive a real commit", () => {
  it("rounds to integers the columns accept, and keeps money's decimals", async () => {
    const res = await runPipeline({
      content: FRACTIONAL,
      platform: "instagram",
      registeredNames: new Set(["A-Creative-1"]),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.warnings.filter((w) => w.code === "W004").map((w) => w.field)).toEqual([
      "impressions",
      "conversions",
      "landing_page_views",
    ]);

    // Insert exactly as the commit route does: counts as numbers, money as
    // strings. Before the fix this threw 22P02 on the first row.
    await db.insert(performanceRecords).values(
      res.rows.map((r) => ({
        accountId: ACCOUNT_A,
        creativeId: CREATIVE_1,
        platform: "instagram" as const,
        campaignId: CAMPAIGN_1,
        date: r.date,
        spend: r.spend.toString(),
        impressions: r.impressions,
        clicks: r.clicks,
        conversions: r.conversions,
        conversionValue: r.conversionValue === null ? null : r.conversionValue.toString(),
        landingPageViews: r.landingPageViews,
        rawPayload: r.rawPayload,
        uploadBatchId: BATCH_A,
      })),
    );

    const stored = await db
      .select({
        date: performanceRecords.date,
        impressions: performanceRecords.impressions,
        conversions: performanceRecords.conversions,
        landingPageViews: performanceRecords.landingPageViews,
        spend: performanceRecords.spend,
        conversionValue: performanceRecords.conversionValue,
      })
      .from(performanceRecords)
      .where(
        and(
          eq(performanceRecords.accountId, ACCOUNT_A),
          eq(performanceRecords.date, "2026-04-01"),
        ),
      );
    expect(stored).toHaveLength(1);
    const row = stored[0]!;
    expect(row.impressions).toBe(1001);
    expect(row.conversions).toBe(12);
    expect(row.landingPageViews).toBe(10);
    // Money kept its cents (and its third decimal) — numeric(14,4).
    expect(Number(row.spend)).toBe(10.49);
    expect(Number(row.conversionValue)).toBe(1234.567);
  });
});
