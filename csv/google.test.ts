import { describe, expect, it } from "vitest";
import { runPipeline } from "@/csv/pipeline";
import { googleAdapter } from "@/csv/platforms/google";
import {
  isFieldUnavailableOn,
  unavailableFieldsFor,
} from "@/csv/platforms/types";

/**
 * The google adapter, end to end through the real pipeline.
 *
 * Google is the STANDARD pipeline (2026-09-20): its export names the creative
 * and the ad group like every other platform's, and the ordinary identity
 * errors apply. The ONLY google-specific behaviour left is its DATA SHAPE —
 * the metrics it cannot report are NULL, never 0 — and that is what these
 * tests exist to pin, alongside the fact that nothing else about it is
 * special.
 */
const REGISTERED = new Set(["URJ_GG_001", "URJ_GG_002"]);
const CAMPAIGNS = new Set(["Search Brand ➤ Exact match", "Search Brand ➤ All"]);

const run = (content: string, registeredCampaigns = CAMPAIGNS) =>
  runPipeline({
    content,
    byteLength: content.length,
    adapter: googleAdapter,
    registeredNames: REGISTERED,
    registeredCampaigns,
  });

const HEADER =
  "Day,Campaign,Ad group,Creative,Cost,Impressions,Clicks,Conversions,Conv. value";

describe("google adapter", () => {
  it("parses a standard export — the file names its creative and ad group", async () => {
    const csv = [
      HEADER,
      "2026-05-01,Search Brand,Exact match,URJ_GG_001,1234.56,10000,500,25,4999.99",
      "2026-05-02,Search Brand,Exact match,URJ_GG_002,10,100,5,0,0",
    ].join("\n");
    const result = await run(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((r) => r.creativeName)).toEqual([
      "URJ_GG_001",
      "URJ_GG_002",
    ]);
    // No platform tag for google — buildCampaignName leaves the name alone.
    expect(result.rows[0]!.campaignName).toBe("Search Brand ➤ Exact match");
    expect(result.rows[0]!.spend).toBe(1234.56);
    expect(result.rows[0]!.conversionValue).toBe(4999.99);
  });

  it("a missing CREATIVE column is the standard E010 — nothing is synthesized", async () => {
    const csv = [
      "Day,Campaign,Ad group,Cost,Impressions,Clicks,Conversions,Conv. value",
      "2026-05-01,Search Brand,Exact match,500,10000,500,25,2000",
    ].join("\n");
    const result = await run(csv);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const missing = result.errors.filter((e) => e.code === "E010");
    expect(missing).toHaveLength(1);
    expect(missing[0]!.field).toBe("creative_name");
  });

  it("a missing AD GROUP column is the standard E010 too", async () => {
    const csv = [
      "Day,Campaign,Creative,Cost,Impressions,Clicks,Conversions,Conv. value",
      "2026-05-01,Search Brand,URJ_GG_001,500,10000,500,25,2000",
    ].join("\n");
    const result = await run(csv);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.filter((e) => e.code === "E010")[0]!.field).toBe(
      "adset_name",
    );
  });

  it("blank identity cells are the standard E042", async () => {
    const csv = [
      HEADER,
      "2026-05-01,Search Brand,,URJ_GG_001,500,10000,500,25,2000",
      "2026-05-02,Search Brand,Exact match,,500,10000,500,25,2000",
    ].join("\n");
    const result = await run(csv);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("E042"); // blank ad group
    expect(codes).toContain("E021"); // blank creative name
  });

  it("an unregistered creative is the standard E020", async () => {
    const csv = [
      HEADER,
      "2026-05-01,Search Brand,Exact match,NOT_IN_LIBRARY,500,10000,500,25,2000",
    ].join("\n");
    const result = await run(csv);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.code)).toContain("E020");
  });

  it("stores NULL — not 0 — for every metric google doesn't report", async () => {
    const csv = [
      HEADER,
      "2026-05-01,Search Brand,Exact match,URJ_GG_001,500,10000,500,25,2000",
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
      "Day,Campaign,Ad group,Creative,Cost,Impressions,Conversions,Conv. value",
      "2026-05-01,Search Brand,Exact match,URJ_GG_001,500,10000,25,2000",
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
      HEADER,
      '2026-05-01,Search Brand,Exact match,URJ_GG_001,"$12,345.67","1,000,000","12,345","1,234","98,765.43"',
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
      HEADER,
      "2026-05-01,Search Brand,Exact match,URJ_GG_001,500,10000,500,25,2000",
      "Total: all campaigns,,,,500,10000,500,25,2000",
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
    // Identity is standard: both columns are required like everywhere else.
    expect(googleAdapter.requiredFields).toContain("creative_name");
    expect(googleAdapter.requiredFields).toContain("adset_name");
    // The social platforms are untouched: they report everything.
    expect(unavailableFieldsFor("tiktok")).toEqual([]);
  });
});
