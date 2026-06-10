import "server-only";
import { cookies } from "next/headers";
import {
  DATE_RANGE_COOKIE,
  decodeRememberedRange,
  defaultDateRange,
  todayIso,
  type DateRangeValue,
} from "@/lib/date-presets";

/**
 * The range to use when a page has no explicit `from`/`to` in its URL: the
 * user's remembered choice (the `ccms_date_range` cookie), or — when nothing is
 * remembered yet or the cookie is unreadable — the fixed fallback (last 7 days).
 *
 * Reading the cookie server-side means the default is applied during SSR, so
 * there's no client-side flash or double data-fetch.
 */
export async function readRememberedRange(): Promise<DateRangeValue> {
  const store = await cookies();
  let raw = store.get(DATE_RANGE_COOKIE)?.value;
  // Tolerate a percent-encoded value (an earlier client-side writer encoded the
  // `custom:` prefix) as well as the clean value the server action stores now.
  if (raw && raw.includes("%")) {
    try {
      raw = decodeURIComponent(raw);
    } catch {
      // keep the raw value
    }
  }
  return decodeRememberedRange(raw, todayIso()) ?? defaultDateRange();
}

/**
 * Effective range for a page: the explicit URL range when both ends are
 * present, otherwise the user's remembered range (or the fixed fallback). This
 * is the single entry point pages use to resolve their date window.
 */
export async function resolveRememberedRange(
  from: string | null | undefined,
  to: string | null | undefined,
): Promise<DateRangeValue> {
  if (from && to) return { from, to };
  return readRememberedRange();
}
