import { resolveFilterPrefs } from "@/db/queries/user-prefs";
import { storeOrdersFiltersSchema } from "@/validators/store";
import { platformEnum } from "@/lib/enums";
import { CHANNEL_DESTINATIONS, UNMAPPED_CHANNEL } from "@/store/channels";
import { UNATTRIBUTED } from "@/store/sources";

/**
 * Store → Orders: the Filters dialog's keys, remembered per user per brand
 * like every standard filter (0049). `platforms` and `channels` are SHARED
 * with Insights on purpose — the same key, the same buckets, the same
 * remembered choice. The status tab (`stage`), the search, sort and page are
 * never remembered.
 */
export const STORE_ORDER_FILTER_KEYS = [
  "payments",
  "paymentTypes",
  "platforms",
  "channels",
  "skus",
  "coupons",
  "offers",
] as const;

/**
 * The page's filters resolved ONCE, server-side — URL → the user's
 * remembered value → none — and parsed. The page and the CSV export both call
 * it, so a remembered filter the URL doesn't carry still narrows the file
 * exactly as it narrows the table.
 */
export async function resolveStoreOrderFilters(raw: (key: string) => string | undefined) {
  const pref = await resolveFilterPrefs(
    STORE_ORDER_FILTER_KEYS.map((key) =>
      key === "platforms"
        ? { key, allow: [...platformEnum, UNATTRIBUTED] }
        : key === "channels"
          ? { key, allow: [...CHANNEL_DESTINATIONS, UNMAPPED_CHANNEL] }
          : { key },
    ),
    raw,
  );
  const f = storeOrdersFiltersSchema.parse({
    from: raw("from"),
    to: raw("to"),
    q: raw("q"),
    page: raw("page"),
    sort: raw("sort"),
    dir: raw("dir"),
    stage: raw("stage"),
    ...pref,
  });
  return { f, pref };
}
