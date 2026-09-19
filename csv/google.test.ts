import { describe, expect, it } from "vitest";
import { runPipeline } from "@/csv/pipeline";
import { googleAdapter } from "@/csv/platforms/google";
import {
  isFieldUnavailableOn,
  unavailableFieldsFor,
} from "@/csv/platforms/types";
import { GOOGLE_SYSTEM_CREATIVE_NAME } from "@/lib/google";

/**
 * The google adapter, end to end through the real pipeline. Two google-only
 * allowances are pinned here because both are easy to "fix" by accident:
 * the synthesized creative name / "All" ad group, and NULL (never 0) for the
 * metrics google simply doesn't report.
 */
const REGISTERED = new Set([GOOGLE_SYSTEM_CREATIVE_NAME]);
const CAMPAIGNS = new Set(["Search Brand ➤ All", "Search Brand ➤ Exact match"]);

const run = (content: string, registeredCampaigns = CAMPAIGNS) =>
  runPipeline({
    content,
    byteLength: content.length,
    adapter: googleAdapter,
    registeredNames: REGISTERED,
    registeredCampaigns,
  });

const FULL_HEADER = "Day,Campaign,Ad group,Cost,Impressions,Clicks,Conversions,Conv. value";
const CAMPAIGN_LEVEL_HEADER = "Day,Campaign,Cost,Impressions,Clicks,Conversions,Conv. value";

describe("google adapter", () => {
  it("parses a campaign+ad-group export, stamping the system creative on every row", async () => {
    const csv = [
      FULL_HEADER,
      "2026-05-01,Search Brand,Exact match,1234.56,10000,500,25,4999.99",
      "2026-05-02,Search Brand,Exact match,10,100,5,0,0",
    ].join("\n");
    const result = await run(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r) => r.creativeName === GOOGLE_SYSTEM_CREATIVE_NAME)).toBe(true);
    // No platform tag for google — buildCampaignName leaves the name alone.
    expect(result.rows[0]!.campaignName).toBe("Search Brand ➤ Exact match");
    expect(result.rows[0]!.spend).toBe(1234.56);
    expect(result.rows[0]!.conversionValue).toBe(4999.99);
  });

  it("synthesizes the ad group as “All” when the COLUMN is absent", async () => {
    const csv = [
      CAMPAIGN_LEVEL_HEADER,
      "2026-05-01,Search Brand,500,10000,500,25,2000",
    ].join("\n");
    const result = await run(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]!.campaignName).toBe("Search Brand ➤ All");
  });

  it("a PRESENT-but-blank ad group is still E042 — synthesis is for absent COLUMNS", async () => {
    const csv = [
      FULL_HEADER,
      "2026-05-01,Search Brand,,500,10000,500,25,2000",
    ].join("\n");
    const result = await run(csv);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.code)).toContain("E042");
  });

  it("stores NULL — not 0 — for every metric google doesn't report", async () => {
    const csv = [
      FULL_HEADER,
      "2026-05-01,Search Brand,Exact match,500,10000,500,25,2000",
    ].join("\n");
    const result = await run(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const r = result.rows[0]!;
    // "Not measured" is not "measured zero": only NULL keeps these rows out of
    // both sides of a blended funnel rate (see lib/metrics.ts).
    expect(r.landingPageViews).toBeNull();
    expect(r.addToCart).toBeNull();
    expect(r.addPayment).toBeNull();
    expect(r.videoViews2s).toBeNull();
    expect(r.videoViews25).toBeNull();
    expect(r.videoViews50).toBeNull();
    expect(r.videoViews75).toBeNull();
    expect(r.videoViews100).toBeNull();
    // …while everything google DOES report is a real number.
    expect(r.spend).toBe(500);
    expect(r.impressions).toBe(10000);
    expect(r.clicks).toBe(500);
    expect(r.conversions).toBe(25);
  });

  it("no E010 for the columns google can't have, but a genuine miss still fails", async () => {
    const missingClicks = [
      "Day,Campaign,Ad group,Cost,Impressions,Conversions,Conv. value",
      "2026-05-01,Search Brand,Exact match,500,10000,25,2000",
    ].join("\n");
    const result = await run(missingClicks);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const missing = result.errors.filter((e) => e.code === "E010");
    expect(missing).toHaveLength(1);
    expect(missing[0]!.field).toBe("clicks");
  });

  it("tolerates thousands separators and currency symbols in the numbers", async () => {
    const csv = [
      FULL_HEADER,
      '2026-05-01,Search Brand,Exact match,"$12,345.67","1,000,000","12,345","1,234","98,765.43"',
    ].join("\n");
    const result = await run(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const r = result.rows[0]!;
    expect(r.spend).toBe(12345.67);
    expect(r.impressions).toBe(1000000);
    expect(r.clicks).toBe(12345);
    expect(r.conversions).toBe(1234);
    expect(r.conversionValue).toBe(98765.43);
  });

  it("skips the export's trailing “Total: …” summary row", async () => {
    const csv = [
      FULL_HEADER,
      "2026-05-01,Search Brand,Exact match,500,10000,500,25,2000",
      "Total: all campaigns,,,500,10000,500,25,2000",
    ].join("\n");
    const result = await run(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
  });

  it("declares its unavailable set from FIELD_META, and requires nothing it can't report", () => {
    expect(unavailableFieldsFor("google")).toEqual([
      "landing_page_views",
      "add_to_cart",
      "add_payment",
      "video_views_2s",
      "video_views_25",
      "video_views_50",
      "video_views_75",
      "video_views_100",
    ]);
    for (const f of googleAdapter.requiredFields) {
      expect(isFieldUnavailableOn(f, "google")).toBe(false);
    }
    // The social platforms are untouched: they report everything.
    expect(unavailableFieldsFor("tiktok")).toEqual([]);
  });
});
