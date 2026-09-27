import { describe, expect, it } from "vitest";
import {
  CHANNEL_LENS,
  OTHER_VALUE,
  PLATFORM_LENS,
  TOP_VALUE_LIMIT,
  aov,
  foldTopValues,
  insightDimensions,
  resolveDimension,
  share,
  valueLabel,
} from "@/lib/store-insights";
import { UNATTRIBUTED } from "@/store/sources";
import { UNMAPPED_CHANNEL } from "@/store/channels";
import type { StoreField } from "@/store/fields";

const field = (
  key: string,
  label: string,
  opts: Partial<StoreField> = {},
): StoreField => ({
  id: key,
  key,
  label,
  type: "text",
  required: false,
  headers: [],
  sortOrder: 0,
  core: false,
  systemRequired: false,
  ...opts,
});

/** A brand's config as `listStoreFields` returns it: sorted, core included. */
const FIELDS: StoreField[] = [
  field("order_id", "Order ID", { core: true, required: true, sortOrder: 0 }),
  field("order_date", "Order date", { core: true, required: true, type: "date", sortOrder: 1 }),
  field("total_amount", "Total amount", { core: true, required: true, type: "number", sortOrder: 2 }),
  field("utm_source", "UTM source", { systemRequired: true, required: true, sortOrder: 3 }),
  field("channel", "Channel", { systemRequired: true, required: true, sortOrder: 4 }),
  field("coupon", "Coupon code", { sortOrder: 5 }),
  field("city", "City", { sortOrder: 6 }),
];

describe("insightDimensions", () => {
  it("derives the list from the config — system-required, customs, then lenses", () => {
    expect(insightDimensions(FIELDS).map((d) => d.key)).toEqual([
      "utm_source",
      "channel",
      "coupon",
      "city",
      PLATFORM_LENS,
      CHANNEL_LENS,
    ]);
  });

  it("never offers a CORE field — identity, the trend's own axis, the measure", () => {
    const keys = insightDimensions(FIELDS).map((d) => d.key);
    expect(keys).not.toContain("order_id");
    expect(keys).not.toContain("order_date");
    expect(keys).not.toContain("total_amount");
  });

  it("a newly configured field shows up with its configured label", () => {
    const withNew = [...FIELDS, field("salesperson", "Salesperson", { sortOrder: 7 })];
    const dims = insightDimensions(withNew);
    expect(dims.find((d) => d.key === "salesperson")?.label).toBe("Salesperson");
    // Relabelling a field in the config relabels the option — no second list.
    const relabelled = insightDimensions(
      FIELDS.map((f) => (f.key === "coupon" ? { ...f, label: "Voucher" } : f)),
    );
    expect(relabelled.find((d) => d.key === "coupon")?.label).toBe("Voucher");
  });

  it("offers the two lenses even for a brand with no custom fields", () => {
    const bare = insightDimensions(FIELDS.filter((f) => f.core));
    expect(bare.map((d) => d.key)).toEqual([PLATFORM_LENS, CHANNEL_LENS]);
  });
});

describe("resolveDimension", () => {
  const dims = insightDimensions(FIELDS);

  it("defaults to UTM source", () => {
    expect(resolveDimension(undefined, dims)?.key).toBe("utm_source");
  });

  it("honours a valid ?by=", () => {
    expect(resolveDimension("coupon", dims)?.key).toBe("coupon");
    expect(resolveDimension(CHANNEL_LENS, dims)?.key).toBe(CHANNEL_LENS);
  });

  it("falls back when the stored dimension's field was DELETED", () => {
    const afterDelete = insightDimensions(FIELDS.filter((f) => f.key !== "coupon"));
    // A remembered `?by=coupon` must not scan a column nobody offers.
    expect(resolveDimension("coupon", afterDelete)?.key).toBe("utm_source");
    expect(resolveDimension("../etc/passwd", dims)?.key).toBe("utm_source");
  });

  it("falls back to the FIRST option when even UTM source is gone", () => {
    const dims2 = insightDimensions(FIELDS.filter((f) => f.key !== "utm_source"));
    expect(resolveDimension(undefined, dims2)?.key).toBe("channel");
  });

  it("is null only when there is nothing to analyze by", () => {
    expect(resolveDimension("utm_source", [])).toBeNull();
  });
});

describe("aov and share", () => {
  it("averages revenue over orders", () => {
    expect(aov(300, 2)).toBe(150);
  });

  it("is a DASH at zero orders, never a divide-by-zero", () => {
    expect(aov(0, 0)).toBeNull();
    expect(aov(100, 0)).toBeNull(); // refunds/adjustments without orders
  });

  it("shares are null on an empty range, so nothing reads as 0%", () => {
    expect(share(3, 10)).toBeCloseTo(0.3, 10);
    expect(share(0, 0)).toBeNull();
  });
});

describe("foldTopValues", () => {
  const rows = (n: number, from = 0) =>
    Array.from({ length: n }, (_, i) => ({
      value: `v${i + from}`,
      orders: n - i,
      revenue: (n - i) * 10,
    }));

  it("leaves a short breakdown alone, sorted by orders", () => {
    const out = foldTopValues([
      { value: "a", orders: 1, revenue: 10 },
      { value: "b", orders: 5, revenue: 50 },
    ]);
    expect(out.map((r) => r.value)).toEqual(["b", "a"]);
    expect(out.every((r) => r.foldedCount === 1)).toBe(true);
  });

  it("keeps exactly the limit without folding", () => {
    const out = foldTopValues(rows(TOP_VALUE_LIMIT));
    expect(out).toHaveLength(TOP_VALUE_LIMIT);
    expect(out.some((r) => r.value === OTHER_VALUE)).toBe(false);
  });

  it("folds the tail into ONE row past the limit", () => {
    const out = foldTopValues(rows(TOP_VALUE_LIMIT + 5));
    expect(out).toHaveLength(TOP_VALUE_LIMIT + 1);
    const other = out.at(-1)!;
    expect(other.value).toBe(OTHER_VALUE);
    expect(other.foldedCount).toBe(5);
  });

  it("PRESERVES the totals — the fold is a reading aid, not a filter", () => {
    const src = rows(57);
    const out = foldTopValues(src);
    expect(out.reduce((a, r) => a + r.orders, 0)).toBe(
      src.reduce((a, r) => a + r.orders, 0),
    );
    expect(out.reduce((a, r) => a + r.revenue, 0)).toBe(
      src.reduce((a, r) => a + r.revenue, 0),
    );
  });

  it("folds by ORDERS — the blank bucket is folded like any other value", () => {
    const src = [
      ...rows(3),
      { value: null, orders: 100, revenue: 1000 },
    ];
    const out = foldTopValues(src, 2);
    expect(out[0]!.value).toBeNull(); // biggest, whatever it is
    expect(out.at(-1)!.foldedCount).toBe(2);
  });
});

describe("valueLabel", () => {
  const dims = insightDimensions(FIELDS);
  const utm = dims.find((d) => d.key === "utm_source")!;
  const platform = dims.find((d) => d.key === PLATFORM_LENS)!;
  const channel = dims.find((d) => d.key === CHANNEL_LENS)!;

  it("names the blank bucket after the field — never drops it", () => {
    // An acronym keeps its case; an ordinary label is lowered into the phrase.
    expect(valueLabel(null, utm)).toBe("No UTM source");
    expect(valueLabel(null, dims.find((d) => d.key === "coupon")!)).toBe(
      "No coupon code",
    );
  });

  it("reuses Reconciliation's vocabulary for the two lenses", () => {
    expect(valueLabel("instagram", platform)).toBe("Instagram");
    expect(valueLabel(UNATTRIBUTED, platform)).toBe("Unattributed");
    expect(valueLabel("website", channel)).toBe("Website");
    expect(valueLabel(UNMAPPED_CHANNEL, channel)).toBe("Unmapped");
  });

  it("shows a field's raw value as-is", () => {
    expect(valueLabel("ig_ad", utm)).toBe("ig_ad");
  });

  it("says how many values the Other row stands for", () => {
    expect(valueLabel(OTHER_VALUE, utm, 12)).toBe("Other (12 values)");
    expect(valueLabel(OTHER_VALUE, utm, 1)).toBe("Other (1 value)");
  });
});
