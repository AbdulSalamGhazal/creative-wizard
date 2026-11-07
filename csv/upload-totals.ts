import type { ParsedRow } from "@/csv/pipeline";

/**
 * The figures a media buyer cross-checks against Ads Manager before
 * importing (R-082): spend, conversions, revenue and how many campaigns the
 * file touches. Summed from the validated rows — post-W004 rounding, so the
 * counts equal what commits. Conversions / revenue are NULL (a dash) when no
 * row reports them: a platform that never measured a field is not one that
 * measured zero (google-platforms.md).
 */
export interface UploadTotals {
  spend: number;
  conversions: number | null;
  revenue: number | null;
  campaigns: number;
}

export function uploadTotals(rows: readonly ParsedRow[]): UploadTotals {
  let spend = 0;
  let conversions: number | null = null;
  let revenue: number | null = null;
  const campaigns = new Set<string>();
  for (const r of rows) {
    spend += r.spend;
    if (r.conversions !== null) conversions = (conversions ?? 0) + r.conversions;
    if (r.conversionValue !== null) revenue = (revenue ?? 0) + r.conversionValue;
    campaigns.add(r.campaignName);
  }
  return { spend, conversions, revenue, campaigns: campaigns.size };
}
