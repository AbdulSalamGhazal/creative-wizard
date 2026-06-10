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

/**
 * Effective range for a page: the explicit URL range when both ends are set,
 * otherwise the user's remembered range, otherwise the page's own `fallback`
 * (so a first-time user with no preference keeps the existing default).
 */
export async function resolvePreferredRange(
  from: string | null | undefined,
  to: string | null | undefined,
  fallback: DateRangeValue,
): Promise<DateRangeValue> {
  if (from && to) return { from, to };
  return (await getPreferredRange()) ?? fallback;
}
