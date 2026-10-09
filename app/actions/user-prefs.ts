"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import {
  deleteTablePref,
  writeFilterPrefs,
  writeTablePrefs,
} from "@/db/queries/user-prefs";
import {
  filterPrefsSchema,
  resetTableColumnsSchema,
  tableColumnsSchema,
} from "@/validators/user-prefs";
import { decodePreferredRange, todayIso } from "@/lib/date-presets";
import { isToastScope } from "@/lib/notifications";

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
 * Persist which arriving notifications may toast (migration 0050). SELF-ONLY —
 * `requireAuth()` is the subject, there is no id in the input — validated
 * against the vocabulary, and NOT audited: a preference change is churn, not
 * history (the same reasoning as notification reads). `revalidatePath` so the
 * layout re-renders with the new value, like the other two prefs here.
 */
export async function setToastScope(value: unknown): Promise<{ ok: boolean }> {
  try {
    if (!isToastScope(value)) return { ok: false };
    const user = await requireAuth();
    await db.update(users).set({ toastScope: value }).where(eq(users.id, user.id));
    // The write is the point; refreshing the layout is a convenience, and
    // outside a request scope (a test, a background call) it throws.
    try {
      revalidatePath("/", "layout");
    } catch (err) {
      console.warn("revalidatePath after toast-scope change failed:", err);
    }
    return { ok: true };
  } catch {
    return { ok: false };
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

/**
 * Write-through for a table's remembered columns (2026-10). Called
 * fire-and-forget by `useTableColumns` after a visibility toggle or a reorder,
 * on the filters' terms: SELF-ONLY (the session user is the subject — there is
 * no user id in the input), account-scoped, validated against the TABLE_KEYS
 * registry, and NOT audited, because preference churn is noise.
 *
 * Best-effort by design: remembering a column choice must never block or delay
 * the interaction that caused it, so a failure returns quietly and the caller
 * warns.
 */
export async function setTableColumns(input: unknown): Promise<{ ok: boolean }> {
  try {
    const parsed = tableColumnsSchema.safeParse(input);
    if (!parsed.success) return { ok: false };
    const user = await requireAuth();
    const acct = await getActiveAccountId();
    await writeTablePrefs(user.id, acct, parsed.data);
    // No revalidatePath: what is on screen is already right; the preference is
    // for the NEXT bare visit.
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** "Reset to default" — DELETE the row, the filters' cleared-row rule. */
export async function resetTableColumns(input: unknown): Promise<{ ok: boolean }> {
  try {
    const parsed = resetTableColumnsSchema.safeParse(input);
    if (!parsed.success) return { ok: false };
    const user = await requireAuth();
    const acct = await getActiveAccountId();
    await deleteTablePref(user.id, acct, parsed.data.tableKey);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
