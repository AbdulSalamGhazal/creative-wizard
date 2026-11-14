import { brandPermanentRedirect } from "@/lib/brand-redirect";

/**
 * Pacing became Analysis (2026-11-14, the Budget restructure): the same page —
 * any range, the chart, the periods and the board — with the results lens
 * added. A permanent redirect keeps bookmarks, saved links and notification
 * deep links working; every param carries across verbatim (the keys are the
 * same).
 */
export default async function BudgetPacingRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) for (const v of value) qs.append(key, v);
    else if (value !== undefined) qs.set(key, value);
  }
  const query = qs.toString();
  return brandPermanentRedirect(query ? `/budget/analysis?${query}` : "/budget/analysis");
}
