import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
  decodePreferredRange,
  todayIso,
  type DateRangeValue,
} from "@/lib/date-presets";

/**
 * The signed-in user's remembered default date range, decoded for today, or
 * null when they haven't set one. `cache()`-deduped per request.
 */
export const getPreferredRange = cache(
  async (): Promise<DateRangeValue | null> => {
    const user = await auth();
    if (!user) return null;
    const [row] = await db
      .select({ pref: users.preferredDateRange })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    return decodePreferredRange(row?.pref, todayIso());
  },
);

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Effective range for a page: the explicit URL range when both ends are present
 * AND valid ISO dates, otherwise the user's remembered range, otherwise the
 * page's own `fallback` (so a first-time user keeps the existing default).
 *
 * IMPORTANT: pass the RAW search params (e.g. `pickFirst(params.from)`), NOT a
 * validator's output. Several filter validators backfill from/to to a default
 * (`.transform(v => v ?? defaultDateRange().from)`), so their value is never
 * absent — passing that here would mask the saved preference on every page.
 * The explicit ISO check makes the helper robust even if a defaulted value
 * leaks through, and guards against a malformed URL value.
 */
export async function resolvePreferredRange(
  from: string | null | undefined,
  to: string | null | undefined,
  fallback: DateRangeValue,
): Promise<DateRangeValue> {
  if (from && to && ISO.test(from) && ISO.test(to) && from <= to) {
    return { from, to };
  }
  return (await getPreferredRange()) ?? fallback;
}
