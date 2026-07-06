/**
 * Canonical column labels for the metric columns shared across the dashboard
 * tables. ONE spelling per metric so the four flavors of Impressions
 * ("Impressions" / "Impr." / "Impr" / "Imp.") — and the two of Conversions /
 * Revenue — stop drifting from table to table. Tables use the short forms; a
 * chart axis or filter dropdown that wants the full word can still spell it out.
 */
export const METRIC_LABEL = {
  spend: "Spend",
  impressions: "Impr.",
  clicks: "Clicks",
  landingPageViews: "LP views",
  addToCart: "ATC",
  addPayment: "AP",
  conversions: "Conv.",
  revenue: "Revenue",
  cpm: "CPM",
  cpc: "CPC",
  cpa: "CPA",
  ctr: "CTR",
  voc: "VOC",
  cvr: "CvR",
  roas: "ROAS",
} as const;
