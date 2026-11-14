import { brandPermanentRedirect } from "@/lib/brand-redirect";

/**
 * The old Budget Daily address. It redirected to Pacing from 2026-09; since
 * the 2026-11-14 restructure day pacing has its own page at /budget/days, and
 * this stub points there. `?month=` carries across verbatim.
 */
export default async function BudgetDailyRedirect({
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
  return brandPermanentRedirect(query ? `/budget/days?${query}` : "/budget/days");
}
