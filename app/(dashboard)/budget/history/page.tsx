import { redirect, permanentRedirect } from "next/navigation";

/**
 * Budget History merged into Pacing (2026-09) — its month-over-month table is
 * Pacing's "Monthly" granularity, so the redirect appends it and a bookmark
 * still lands on the same content.
 */
export default async function BudgetHistoryRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "granularity") continue; // the destination pins it below
    if (Array.isArray(value)) for (const v of value) qs.append(key, v);
    else if (value !== undefined) qs.set(key, value);
  }
  qs.set("granularity", "monthly");
  permanentRedirect(`/budget/pacing?${qs.toString()}`);
  // Unreachable — permanentRedirect throws. Satisfies the never-returns lint.
  redirect("/budget/pacing?granularity=monthly");
}
