"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import {
  DATE_RANGE_COOKIE,
  decodeRememberedRange,
  todayIso,
} from "@/lib/date-presets";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/**
 * Persist the user's chosen date range as their default, so any page with no
 * explicit `from`/`to` opens on it. `value` is a preset key (kept rolling) or
 * `custom:FROM..TO`. Set server-side (httpOnly) and `revalidatePath` so the new
 * default takes effect on the next navigation — no client-cache stale read and
 * no document.cookie encoding pitfalls. Best-effort: never throws to the caller.
 */
export async function rememberDateRange(value: string): Promise<void> {
  try {
    await requireAuth();
    // Only store something we can decode back (guards against junk values).
    if (decodeRememberedRange(value, todayIso()) === null) return;
    const jar = await cookies();
    jar.set({
      name: DATE_RANGE_COOKIE,
      value,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });
    revalidatePath("/", "layout");
  } catch {
    // Remembering the range is best-effort; a failure must not break the pick.
  }
}
