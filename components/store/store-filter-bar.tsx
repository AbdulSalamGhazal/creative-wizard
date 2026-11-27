"use client";

import { useDebouncedSearchParam } from "@/components/filters/use-debounced-search-param";
import { DateRangePicker } from "@/components/filters/date-range-picker";
import type { DateRangeValue } from "@/lib/date-presets";
import { FilterSearch } from "@/components/filters/filter-pill";
import { FilterShell } from "@/components/filters/filter-shell";
import { useFilterParams } from "@/components/filters/use-filter-params";
import type { FilterDef } from "@/components/filters/filter-model";
import { platformEnum } from "@/lib/enums";
import { PLATFORM_LABEL } from "@/lib/palette";
import { CHANNEL_DESTINATIONS, CHANNEL_LABEL, UNMAPPED_CHANNEL } from "@/store/channels";
import { UNATTRIBUTED } from "@/store/sources";
import { paymentMethodLabel } from "@/store/payment-methods";
import type { StoreOrderFilterOptions } from "@/db/queries/store";

/** COD vs prepaid as Salla sends it — a known value reads plainly. */
function paymentTypeLabel(v: string): string {
  const s = v.toLowerCase();
  if (s === "cod") return "Cash on delivery";
  if (s === "prepaid" || s === "pre_paid") return "Prepaid";
  return v.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/**
 * Store orders filters (2026-11-27, user decision): the range, a search over
 * the order AND its customer, and a Filters dialog — payment method, COD or
 * prepaid, platform, channel, product, coupon, offer. Status is NOT here: it
 * is the tab row under this bar. Every option list is the brand's own values
 * (`storeOrderFilterOptions`), most-used first. URL-backed and remembered per
 * user per brand like every standard filter; a search is debounced 250ms; any
 * change returns to page 1.
 */
export function StoreFilterBar({
  from,
  to,
  resolvedRange,
  q,
  resolvedFilters,
  options,
}: {
  /** Raw URL range (drives the highlighted preset), null when absent. */
  from: string | null;
  to: string | null;
  /** What the query actually ran — the picker's label falls back to it. */
  resolvedRange: DateRangeValue;
  q: string;
  /** The Filters dialog's keys as the server resolved them (URL → remembered). */
  resolvedFilters: Record<string, string | undefined>;
  options: StoreOrderFilterOptions;
}) {
  const { update, get, searchParams } = useFilterParams(resolvedFilters);

  /** Any filter change → back to page 1. */
  const write = (mutate: (p: URLSearchParams) => void) =>
    update((next) => {
      mutate(next);
      next.delete("page");
    });

  // Debounced `?q=` (250ms) — the shared hook, so a late navigation can't eat
  // typed characters and Back/Forward re-reads the URL. Before the first
  // render the server's parsed `q` stands in for the URL.
  const [qLocal, setQLocal] = useDebouncedSearchParam(searchParams.get("q") ?? q, (v) =>
    write((p) => {
      if (v) p.set("q", v);
      else p.delete("q");
    }),
  );

  const values = (key: string): string[] => {
    const v = get(key);
    return v ? v.split(",").filter(Boolean) : [];
  };
  /** The shared half of a multi def: its values and its URL writer. */
  const wire = (key: string) => ({
    values: values(key),
    onChange: (next: string[]) =>
      write((p) => {
        if (next.length === 0) p.delete(key);
        else p.set(key, next.join(","));
      }),
  });

  // Each def spells its `key:` — the migrated-bars guard reads them to pin
  // that Clear reaches exactly these and nothing protected.
  const filters: FilterDef[] = [
    {
      key: "payments",
      label: "Payment method",
      type: "multi",
      options: options.payments.map((v) => ({ value: v, label: paymentMethodLabel(v) })),
      emptyHint: "No payment methods yet — they come with orders from the Salla feed.",
      ...wire("payments"),
    },
    {
      key: "paymentTypes",
      label: "COD or prepaid",
      type: "multi",
      options: options.paymentTypes.map((v) => ({ value: v, label: paymentTypeLabel(v) })),
      emptyHint: "Not reported yet — it comes with orders from the Salla feed.",
      ...wire("paymentTypes"),
    },
    {
      key: "platforms",
      label: "Platform",
      type: "multi",
      options: [
        ...platformEnum.map((p) => ({ value: p, label: PLATFORM_LABEL[p] })),
        // The bucket, not a platform — an order whose source nobody mapped.
        { value: UNATTRIBUTED, label: "Unattributed" },
      ],
      ...wire("platforms"),
    },
    {
      key: "channels",
      label: "Channel",
      type: "multi",
      options: [
        ...CHANNEL_DESTINATIONS.map((c) => ({ value: c, label: CHANNEL_LABEL[c] })),
        { value: UNMAPPED_CHANNEL, label: "Unmapped" },
      ],
      ...wire("channels"),
    },
    {
      key: "skus",
      label: "Product",
      type: "multi",
      options: options.products.map((p) => ({
        value: p.key,
        label: p.name ?? p.key,
        hint: p.name && p.name !== p.key ? p.key : undefined,
      })),
      emptyHint: "No products yet — they come with orders from the Salla feed.",
      ...wire("skus"),
    },
    {
      key: "coupons",
      label: "Coupon",
      type: "multi",
      options: options.coupons.map((v) => ({ value: v, label: v })),
      emptyHint: "No coupon has been used yet.",
      ...wire("coupons"),
    },
    {
      key: "offers",
      label: "Offer",
      type: "multi",
      options: options.offers.map((v) => ({ value: v, label: v })),
      emptyHint: "No special offer has been applied yet.",
      ...wire("offers"),
    },
  ];

  return (
    <FilterShell
      filters={filters}
      tier1={({ fullWidth }) => (
        <>
          <FilterSearch
            value={qLocal}
            onChange={setQLocal}
            placeholder="Search orders or customers…"
          />
          <DateRangePicker
            from={from}
            to={to}
            onChange={(nf, nt) =>
              write((p) => {
                if (nf) p.set("from", nf);
                else p.delete("from");
                if (nt) p.set("to", nt);
                else p.delete("to");
              })
            }
            remember
            fullWidth={fullWidth}
            fallback={resolvedRange}
          />
        </>
      )}
    />
  );
}
