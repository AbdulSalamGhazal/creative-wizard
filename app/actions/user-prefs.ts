"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import { writeFilterPrefs } from "@/db/queries/user-prefs";
import { filterPrefsSchema } from "@/validators/user-prefs";
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

/**
 * Persist the user's Excluded-toggle choice as their default (mirrors
 * `setPreferredRange`). Applied on any page whose URL has no explicit
 * `includeExcluded` param; an explicit param always wins. Best-effort.
 */
export async function setIncludeExcludedPref(on: boolean): Promise<void> {
  try {
    // Server actions receive untrusted input — only store a real boolean.
    if (typeof on !== "boolean") return;
    const user = await requireAuth();
    await db
      .update(users)
      .set({ includeExcluded: on })
      .where(eq(users.id, user.id));
    revalidatePath("/", "layout");
  } catch {
    // Remembering the toggle is best-effort; a failure must not break it.
  }
}

/**
 * Write-through for the FilterShell's remembered filters (2026-09). Called
 * fire-and-forget by `useFilterParams` after every filter change it writes —
 * a set, a single chip removal, or Clear (which sends empty value sets, and
 * DELETES the rows).
 *
 * Deliberately: account-scoped, validated (never-persist keys are refused
 * centrally), small payloads, and NO audit row — preference churn is noise,
 * the same reasoning as notification reads. Best-effort: a failure must never
 * block or delay a navigation, so it returns quietly and the caller warns.
 */
export async function setFilterPrefs(input: unknown): Promise<{ ok: boolean }> {
  try {
    const parsed = filterPrefsSchema.safeParse(input);
    if (!parsed.success) return { ok: false };
    const user = await requireAuth();
    const acct = await getActiveAccountId();
    await writeFilterPrefs(user.id, acct, parsed.data.entries);
    // No revalidatePath: the URL the user is already on is the truth for this
    // navigation; the preference is for the NEXT bare one.
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
