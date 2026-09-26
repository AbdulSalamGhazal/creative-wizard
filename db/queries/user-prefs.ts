import { cache } from "react";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { userFilterPrefs, users } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import {
  isPersistableFilterKey,
  prefsSuppressed,
  type FilterPrefEntry,
} from "@/validators/user-prefs";
import { resolveIncludeExcludedValue } from "@/lib/exclusion-rules";
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

/**
 * The signed-in user's remembered Excluded-toggle state, or null when they
 * never chose. `cache()`-deduped per request.
 */
const getIncludeExcludedPref = cache(async (): Promise<boolean | null> => {
  const user = await auth();
  if (!user) return null;
  const [row] = await db
    .select({ pref: users.includeExcluded })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  return row?.pref ?? null;
});

/**
 * Effective Excluded-toggle state for a page: the explicit URL param wins
 * ("1" → shown, "0" → hidden), otherwise the user's remembered choice,
 * otherwise hidden (the safe default). Pass the RAW search param — same
 * caveat as `resolvePreferredRange`.
 */
export async function resolveIncludeExcluded(
  raw: string | null | undefined,
): Promise<boolean> {
  return resolveIncludeExcludedValue(raw, await getIncludeExcludedPref());
}

// ── Remembered FILTER preferences (2026-09, migration 0049) ─────────────────
// The date range's behaviour, generalized: a filter the user set last time
// applies again, per BRAND, wherever the same KEY exists. Resolution happens
// SERVER-side, like the range — a control must never show a filter the query
// didn't actually run.

/**
 * Every remembered filter for (signed-in user, active brand) — ONE read,
 * `cache()`-deduped per request, so a page resolving six keys still costs a
 * single round-trip on the `max: 1` pool.
 */
export const getFilterPrefs = cache(async (): Promise<Map<string, string[]>> => {
  const user = await auth();
  if (!user) return new Map();
  const acct = await getActiveAccountId();
  const rows = await db
    .select({ key: userFilterPrefs.filterKey, values: userFilterPrefs.values })
    .from(userFilterPrefs)
    .where(and(eq(userFilterPrefs.userId, user.id), eq(userFilterPrefs.accountId, acct)));
  return new Map(rows.map((r) => [r.key, r.values]));
});

/** What a page asks to resolve: a key, and optionally the ids that still exist. */
export interface FilterPrefSpec {
  key: string;
  /**
   * The values this page can still honour — product ids, angle names. A
   * remembered value outside it is DROPPED silently (the stale-cookie
   * discipline): a deleted product must never filter a page to nothing, and a
   * pref must never crash one. Enum-shaped keys can omit this — their
   * validators already drop what they don't recognise.
   */
  allow?: readonly string[];
}

/**
 * The effective value of each filter key, as the param string a page's
 * validator expects: the URL wins, else the remembered preference, else
 * undefined (the page's own default).
 *
 * Pass the RAW search params — same caveat as `resolvePreferredRange`: a
 * validator's output is already defaulted, so it would mask the preference.
 *
 * Two things suppress preferences entirely, both checked HERE rather than by
 * each page (`prefsSuppressed`):
 *  · a saved view is being applied — the view owns the filter state, including
 *    what it leaves out (removing the default view restores preferences);
 *  · the URL already states its filters in full (`fx`) — the shell stamps that
 *    on every filter change, so a filter the user just cleared cannot come
 *    back from its own preference before the write-through lands.
 * `opts.skip` forces the same thing for a caller that knows more.
 */
export async function resolveFilterPrefs(
  specs: readonly FilterPrefSpec[],
  raw: (key: string) => string | undefined,
  opts: { skip?: boolean } = {},
): Promise<Record<string, string | undefined>> {
  const out: Record<string, string | undefined> = {};
  const suppressed = opts.skip === true || prefsSuppressed(raw);
  const prefs = suppressed ? new Map<string, string[]>() : await getFilterPrefs();
  for (const spec of specs) {
    const fromUrl = raw(spec.key);
    if (fromUrl !== undefined && fromUrl !== "") {
      out[spec.key] = fromUrl;
      continue;
    }
    const remembered = isPersistableFilterKey(spec.key)
      ? prefs.get(spec.key)
      : undefined;
    if (!remembered || remembered.length === 0) {
      out[spec.key] = undefined;
      continue;
    }
    const kept = spec.allow
      ? remembered.filter((v) => (spec.allow as readonly string[]).includes(v))
      : remembered;
    out[spec.key] = kept.length > 0 ? kept.join(",") : undefined;
  }
  return out;
}

/**
 * Write-through for a burst of filter changes: a non-empty set UPSERTS, an
 * empty one DELETES. Deleting is the point — a filter the user cleared must
 * stay cleared on the next bare navigation, rather than resurrecting from its
 * own preference.
 */
export async function writeFilterPrefs(
  userId: string,
  accountId: string,
  entries: readonly FilterPrefEntry[],
): Promise<void> {
  const remove = entries.filter((e) => e.values.length === 0).map((e) => e.key);
  const upsert = entries.filter((e) => e.values.length > 0);

  if (remove.length > 0) {
    await db
      .delete(userFilterPrefs)
      .where(
        and(
          eq(userFilterPrefs.userId, userId),
          eq(userFilterPrefs.accountId, accountId),
          inArray(userFilterPrefs.filterKey, remove),
        ),
      );
  }
  if (upsert.length > 0) {
    await db
      .insert(userFilterPrefs)
      .values(
        upsert.map((e) => ({
          userId,
          accountId,
          filterKey: e.key,
          values: e.values,
          updatedAt: new Date(),
        })),
      )
      .onConflictDoUpdate({
        target: [userFilterPrefs.userId, userFilterPrefs.accountId, userFilterPrefs.filterKey],
        set: { values: sql`excluded.values`, updatedAt: new Date() },
      });
  }
}
