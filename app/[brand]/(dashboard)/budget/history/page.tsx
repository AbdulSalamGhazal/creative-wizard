import { brandPermanentRedirect } from "@/lib/brand-redirect";

/**
 * The old Budget History address. Its month-over-month table is what Review
 * shows (2026-11-14, the restructure) — months compared, planned against
 * actual — so a bookmark lands on the same content.
 */
export default async function BudgetHistoryRedirect() {
  return brandPermanentRedirect("/budget/review");
}
