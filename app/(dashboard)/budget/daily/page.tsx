import { redirect, permanentRedirect } from "next/navigation";

/**
 * Budget Daily merged into Pacing (2026-09) — its per-day view is Pacing's
 * "Group by → Day". Kept as a permanent redirect so bookmarks and older audit
 * links keep working; `?month=` carries across verbatim.
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
  permanentRedirect(query ? `/budget/pacing?${query}` : "/budget/pacing");
  // Unreachable — permanentRedirect throws. Satisfies the never-returns lint.
  redirect("/budget/pacing");
}
