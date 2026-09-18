/**
 * Store CHANNEL vocabulary — the second mapping axis (the first is
 * utm_source → ad platform).
 *
 * A channel value on an order says WHERE the purchase happened; each distinct
 * raw value is mapped EXPLICITLY to one of two destinations. Nothing is ever
 * auto-matched (the house rule), and an unmapped or blank channel falls into
 * its own visible bucket rather than being absorbed into either side.
 *
 * Why the split matters: platform pixels largely see WEBSITE purchases, so
 * "Δ excl. app" (claimed − website) is the honest attribution gap, and the
 * Application column explains the rest.
 */

export const CHANNEL_DESTINATIONS = ["website", "application"] as const;
export type ChannelDestination = (typeof CHANNEL_DESTINATIONS)[number];

export const CHANNEL_LABEL: Record<ChannelDestination, string> = {
  website: "Website",
  application: "Application",
};

export function isChannelDestination(value: string): value is ChannelDestination {
  return (CHANNEL_DESTINATIONS as readonly string[]).includes(value);
}

/** Sentinel bucket: no mapping for this order's channel (or the cell is blank). */
export const UNMAPPED_CHANNEL = "__unmapped__";

/** The field whose values carry the channel. Pinned, like the source field. */
export const STORE_CHANNEL_FIELD_KEY = "channel";

export interface ChannelDeltas {
  /** claimed − (Website + Application). */
  inclApp: number;
  /** claimed − Website — the honest attribution gap for pixel-based claims. */
  exclApp: number;
}

/**
 * Both deltas for one day (or one total row), in the page's INFLATION framing
 * (2026-09-19): **claimed − actual**, so POSITIVE = platforms claim more than
 * the store recorded. Website 80, claimed 100 → Δ excl. app = +20.
 *
 * UNMAPPED IS NEVER ABSORBED into either delta: orders whose channel nobody has
 * mapped are not evidence about website or app, so they stay in their own
 * column. Counting them would quietly flatter whichever side they were folded
 * into.
 */
export function channelDeltas(input: {
  website: number;
  application: number;
  claimed: number;
}): ChannelDeltas {
  return {
    inclApp: input.claimed - (input.website + input.application),
    exclApp: input.claimed - input.website,
  };
}

export interface ChannelDayRow {
  website: number;
  application: number;
  unmapped: number;
  storeOrders: number;
  claimed: number;
  revenue: number;
  spend: number;
}

/**
 * Range totals for the Channels table: plain COMPONENT SUMS. The totals row's
 * deltas are then `channelDeltas` OVER THESE SUMS — never an average of the
 * per-day deltas, which is a different number whenever the days differ in size.
 */
export function sumChannelDays(rows: readonly ChannelDayRow[]): ChannelDayRow {
  return rows.reduce<ChannelDayRow>(
    (a, r) => ({
      website: a.website + r.website,
      application: a.application + r.application,
      unmapped: a.unmapped + r.unmapped,
      storeOrders: a.storeOrders + r.storeOrders,
      claimed: a.claimed + r.claimed,
      revenue: a.revenue + r.revenue,
      spend: a.spend + r.spend,
    }),
    { website: 0, application: 0, unmapped: 0, storeOrders: 0, claimed: 0, revenue: 0, spend: 0 },
  );
}
