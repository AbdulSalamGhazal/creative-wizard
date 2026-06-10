"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { decodePreferredRange, todayIso } from "@/lib/date-presets";

/**
 * Persist the user's chosen date range as their default. `value` is a preset
 * key (kept rolling) or `custom:FROM..TO`. Mirrors the brand-switcher pattern:
 * write + `revalidatePath` so the new default is reflected on the next render.
 * The client `await`s this then calls `router.refresh()` — that's the piece the
 * earlier cookie attempt was missing. Best-effort: never throws to the caller.
 */
export async function setPreferredRange(value: string): Promise<void> {
  try {
    const user = await requireAuth();
    // Only store something we can decode back (guards against junk values).
    if (decodePreferredRange(value, todayIso()) === null) return;
    await db
      .update(users)
      .set({ preferredDateRange: value })
      .where(eq(users.id, user.id));
    revalidatePath("/", "layout");
  } catch {
    // Remembering the range is best-effort; a failure must not break the pick.
  }
}
