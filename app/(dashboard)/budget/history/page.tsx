import { redirect, permanentRedirect } from "next/navigation";

/**
 * Budget History merged into Pacing (2026-09). Its month-over-month table is
 * Pacing's month grouping over a twelve-month range, so the redirect asks for
 * exactly that and a bookmark still lands on the same content.
 */
export default async function BudgetHistoryRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    // The destination pins these two below.
    if (key === "granularity" || key === "groupBy") continue;
    if (Array.isArray(value)) for (const v of value) qs.append(key, v);
    else if (value !== undefined) qs.set(key, value);
  }
  qs.set("granularity", "monthly");
  qs.set("groupBy", "month");
  permanentRedirect(`/budget/pacing?${qs.toString()}`);
  // Unreachable — permanentRedirect throws. Satisfies the never-returns lint.
  redirect("/budget/pacing?granularity=monthly&groupBy=month");
}
