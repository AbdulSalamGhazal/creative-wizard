import { redirect, permanentRedirect } from "next/navigation";
import { monthEndIso, monthStartIso } from "@/lib/budget";
import { MONTH_KEY } from "@/validators/budget";

/**
 * The Tracker merged into Pacing (2026-10-19, user decision): its board is
 * Pacing's board, for any range. A permanent redirect keeps bookmarks working:
 * `?month=` becomes that month's from/to (no month → Pacing's default, the
 * current month); every other param (`platforms`, `board`, `rank`, `group`,
 * `buckets`, `offpace`) carries across verbatim — Pacing reads the same keys.
 */
export default async function BudgetTrackerRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "month") continue; // becomes from/to below
    if (Array.isArray(value)) for (const v of value) qs.append(key, v);
    else if (value !== undefined) qs.set(key, value);
  }
  const month = typeof params.month === "string" && MONTH_KEY.test(params.month) ? params.month : null;
  if (month) qs.set("from", monthStartIso(month));
  if (month) qs.set("to", monthEndIso(month));
  const query = qs.toString();
  permanentRedirect(query ? `/budget/pacing?${query}` : "/budget/pacing");
  redirect("/budget/pacing"); // unreachable — permanentRedirect throws
}
