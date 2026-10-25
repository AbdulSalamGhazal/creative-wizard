import { describe, expect, it } from "vitest";
import {
  COMPARE_MAX,
  OTHER_VALUE,
  UTM_BUCKETS,
  accuracyRows,
  bucketizeSeries,
  defaultCompare,
  encodeCompareParam,
  foldSources,
  halfSplitTrend,
  normalizeSourceValue,
  parseCompareParam,
  sourceFromKey,
  sourceKey,
  sourceLabel,
  sourceVariants,
  sumAccuracy,
  utmBucketColor,
  utmBucketLabel,
  utmCoverage,
  type UtmBucketDay,
  type UtmSourceRow,
} from "./store-utms";
import { ALL_PLATFORMS } from "./palette";
import { NO_SOURCE, OTHER_SOURCE, UNMAPPED_SOURCE } from "@/store/sources";
import { dayBucketsInRange, weekBucketsInRange } from "./budget";

const day = (day: string, bucket: UtmBucketDay["bucket"], orders: number, revenue = orders * 10): UtmBucketDay => ({
  day,
  bucket,
  orders,
  revenue,
});

describe("buckets", () => {
  it("lists every platform, then the three unknowns, each with a label and a colour", () => {
    expect(UTM_BUCKETS).toEqual([...ALL_PLATFORMS, OTHER_SOURCE, UNMAPPED_SOURCE, NO_SOURCE]);
    for (const b of UTM_BUCKETS) {
      expect(utmBucketLabel(b)).toBeTruthy();
      expect(utmBucketColor(b)).toMatch(/^var\(--/);
    }
    expect(utmBucketLabel("instagram")).toBe("Instagram");
    expect(utmBucketLabel(NO_SOURCE)).toBe("No UTM");
  });
});

describe("utmCoverage", () => {
  it("sums the four groups so ads + other + unmapped + blank = orders", () => {
    const c = utmCoverage([
      day("2026-06-01", "instagram", 3),
      day("2026-06-01", "facebook", 2),
      day("2026-06-02", "instagram", 1),
      day("2026-06-02", OTHER_SOURCE, 4),
      day("2026-06-02", UNMAPPED_SOURCE, 2),
      day("2026-06-02", NO_SOURCE, 5),
    ]);
    expect(c.orders).toBe(17);
    expect(c.revenue).toBe(170);
    expect(c.ads).toBe(6);
    expect(c.byPlatform.instagram).toBe(4);
    expect(c.byPlatform.facebook).toBe(2);
    expect(c.byPlatform.tiktok).toBe(0);
    expect(c.other).toBe(4);
    expect(c.unmapped).toBe(2);
    expect(c.blank).toBe(5);
    expect(c.ads + c.other + c.unmapped + c.blank).toBe(c.orders);
  });

  it("is all zeros on no rows", () => {
    const c = utmCoverage([]);
    expect(c.orders).toBe(0);
    expect(c.ads).toBe(0);
  });
});

describe("bucketizeSeries", () => {
  const rows = [
    { day: "2026-06-01", key: "a", orders: 2, revenue: 20 },
    { day: "2026-06-02", key: "a", orders: 3, revenue: 30 },
    { day: "2026-06-02", key: "b", orders: 1, revenue: 5 },
    { day: "2026-06-09", key: "a", orders: 7, revenue: 70 },
    // Outside the buckets — never counted.
    { day: "2026-07-01", key: "a", orders: 99, revenue: 990 },
  ];

  it("fills every requested key in every bucket, zero when absent", () => {
    const pts = bucketizeSeries(rows, dayBucketsInRange("2026-06-01", "2026-06-03"), ["a", "b"], "orders");
    expect(pts.map((p) => p.values)).toEqual([
      { a: 2, b: 0 },
      { a: 3, b: 1 },
      { a: 0, b: 0 },
    ]);
  });

  it("rolls into weeks with Pacing's own buckets and reads the revenue metric", () => {
    const pts = bucketizeSeries(rows, weekBucketsInRange("2026-06-01", "2026-06-14"), ["a"], "revenue");
    // 2026-06-01 is a Monday; the first week bucket runs Mon–Sat (ends Saturday 06-06).
    expect(pts[0]!.values.a).toBe(50);
    expect(pts.reduce((s, p) => s + p.values.a!, 0)).toBe(120);
  });

  it("ignores keys it wasn't asked for", () => {
    const pts = bucketizeSeries(rows, dayBucketsInRange("2026-06-02", "2026-06-02"), ["b"], "orders");
    expect(pts[0]!.values).toEqual({ b: 1 });
  });
});

describe("halfSplitTrend", () => {
  const range = { from: "2026-06-01", to: "2026-06-10" };

  it("compares the two halves PER DAY", () => {
    const t = halfSplitTrend(
      [
        { day: "2026-06-01", orders: 10 },
        { day: "2026-06-03", orders: 10 },
        { day: "2026-06-07", orders: 20 },
        { day: "2026-06-10", orders: 20 },
      ],
      range,
    );
    expect(t.firstPerDay).toBeCloseTo(20 / 5);
    expect(t.secondPerDay).toBeCloseTo(40 / 5);
    expect(t.pct).toBeCloseTo(1);
  });

  it("is NULL when the first half had nothing (no base to grow from)", () => {
    const t = halfSplitTrend([{ day: "2026-06-09", orders: 3 }], range);
    expect(t.pct).toBeNull();
    expect(t.secondPerDay).toBeCloseTo(3 / 5);
  });

  it("gives the longer half of an odd range no advantage", () => {
    // 9 days: first half 4 days, second half 5 days — 1 order/day in each.
    const odd = { from: "2026-06-01", to: "2026-06-09" };
    const daily = Array.from({ length: 9 }, (_, i) => ({
      day: `2026-06-0${i + 1}`,
      orders: 1,
    }));
    expect(halfSplitTrend(daily, odd).pct).toBeCloseTo(0);
  });

  it("ignores days outside the range", () => {
    const t = halfSplitTrend(
      [
        { day: "2026-05-30", orders: 100 },
        { day: "2026-06-02", orders: 5 },
        { day: "2026-06-08", orders: 5 },
      ],
      range,
    );
    expect(t.pct).toBeCloseTo(0);
  });
});

describe("sourceVariants", () => {
  it("folds case, spaces and punctuation", () => {
    expect(normalizeSourceValue("Insta-Gram ")).toBe("instagram");
    expect(normalizeSourceValue("fb_ads")).toBe("fbads");
    expect(normalizeSourceValue("سناب شات")).toBe("سنابشات");
  });

  it("groups values that normalize alike, largest first, and says whether they map alike", () => {
    const groups = sourceVariants([
      { value: "instagram", orders: 50, bucket: "instagram" },
      { value: "Instagram", orders: 5, bucket: UNMAPPED_SOURCE },
      { value: "facebook", orders: 30, bucket: "facebook" },
      { value: "fb", orders: 9, bucket: "facebook" },
      { value: "snap chat", orders: 8, bucket: "snapchat" },
      { value: "Snapchat", orders: 20, bucket: "snapchat" },
    ]);
    expect(groups.map((g) => g.key)).toEqual(["instagram", "snapchat"]);
    expect(groups[0]!.members.map((m) => m.value)).toEqual(["instagram", "Instagram"]);
    expect(groups[0]!.orders).toBe(55);
    expect(groups[0]!.sameBucket).toBe(false);
    expect(groups[1]!.members.map((m) => m.value)).toEqual(["Snapchat", "snap chat"]);
    expect(groups[1]!.sameBucket).toBe(true);
  });

  it("returns nothing when every value is distinct", () => {
    expect(
      sourceVariants([
        { value: "a", orders: 1, bucket: OTHER_SOURCE },
        { value: "b", orders: 1, bucket: OTHER_SOURCE },
      ]),
    ).toEqual([]);
  });
});

describe("accuracyRows", () => {
  it("keeps only platforms with data on either side, in house order", () => {
    const rows = accuracyRows({ facebook: 80, instagram: 50 }, { instagram: 100, tiktok: 7 });
    expect(rows.map((r) => r.platform)).toEqual(["instagram", "facebook", "tiktok"]);
  });

  it("uses Reconciliation's framing: Δ = claimed − UTM, Δ% over UTM, ratio = claimed ÷ UTM", () => {
    const [ig] = accuracyRows({ instagram: 80 }, { instagram: 100 });
    expect(ig).toEqual({
      platform: "instagram",
      claimed: 100,
      utm: 80,
      delta: 20,
      deltaPct: 0.25,
      ratio: 1.25,
    });
  });

  it("is NULL, never Infinity, where there are no UTM orders", () => {
    const [tt] = accuracyRows({}, { tiktok: 7 });
    expect(tt!.delta).toBe(7);
    expect(tt!.deltaPct).toBeNull();
    expect(tt!.ratio).toBeNull();
  });

  it("totals are component sums, with the helpers applied OVER the sums", () => {
    const rows = accuracyRows({ instagram: 80, facebook: 20 }, { instagram: 100, facebook: 10 });
    const t = sumAccuracy(rows);
    expect(t.claimed).toBe(110);
    expect(t.utm).toBe(100);
    expect(t.delta).toBe(10);
    expect(t.deltaPct).toBeCloseTo(0.1);
    expect(t.ratio).toBeCloseTo(1.1);
    // NOT the mean of the per-platform ratios (1.25 and 0.5 → 0.875).
    expect(t.ratio).not.toBeCloseTo(0.875);
  });
});

describe("compare param", () => {
  const available = new Set(["instagram", "a,b", NO_SOURCE, "x"]);

  it("round-trips values with commas and the blank bucket", () => {
    const keys = ["instagram", "a,b", NO_SOURCE];
    expect(parseCompareParam(encodeCompareParam(keys), available)).toEqual(keys);
  });

  it("drops unknown keys and duplicates, and caps the list", () => {
    const raw = encodeCompareParam(["instagram", "gone", "instagram", "x", "a,b", NO_SOURCE]);
    expect(parseCompareParam(raw, available)).toEqual(["instagram", "x", "a,b", NO_SOURCE]);
    const many = new Set(Array.from({ length: 10 }, (_, i) => `s${i}`));
    expect(parseCompareParam(encodeCompareParam([...many]), many)).toHaveLength(COMPARE_MAX);
  });

  it("treats a missing param as nothing and a malformed part as skipped", () => {
    expect(parseCompareParam(null, available)).toEqual([]);
    expect(parseCompareParam("%E0%A4%A", available)).toEqual([]);
  });

  it("defaults to the top N by orders, blank excluded", () => {
    expect(
      defaultCompare(
        [
          { value: null, orders: 500 },
          { value: "b", orders: 20 },
          { value: "a", orders: 30 },
          { value: "c", orders: 10 },
          { value: "d", orders: 1 },
        ],
        3,
      ),
    ).toEqual(["a", "b", "c"]);
  });

  it("keys the blank bucket by its sentinel and inverts", () => {
    expect(sourceKey(null)).toBe(NO_SOURCE);
    expect(sourceFromKey(sourceKey(null))).toBeNull();
    expect(sourceFromKey("ig")).toBe("ig");
    expect(sourceLabel(null, "UTM source")).toBe("No UTM source");
    expect(sourceLabel(null, "Traffic source")).toBe("No traffic source");
    expect(sourceLabel("ig", "UTM source")).toBe("ig");
  });
});

describe("foldSources", () => {
  const row = (value: string | null, orders: number, bucket: UtmSourceRow["bucket"] = OTHER_SOURCE): UtmSourceRow => ({
    value,
    bucket,
    orders,
    revenue: orders * 10,
    website: Math.floor(orders / 2),
    application: orders - Math.floor(orders / 2),
  });
  const range = (rows: UtmSourceRow[], values = rows.length) => ({
    orders: rows.reduce((a, r) => a + r.orders, 0),
    revenue: rows.reduce((a, r) => a + r.revenue, 0),
    website: rows.reduce((a, r) => a + r.website, 0),
    application: rows.reduce((a, r) => a + r.application, 0),
    values,
  });

  it("does not fold under the limit", () => {
    const rows = [row("a", 5), row(null, 3), row("b", 9)];
    const out = foldSources(rows, 3, range(rows));
    expect(out.map((r) => r.value)).toEqual(["b", "a", null]);
    expect(out.every((r) => r.foldedCount === 1)).toBe(true);
  });

  it("folds the tail into ONE Other row that keeps the totals exact", () => {
    const rows = [row("a", 10), row("b", 8), row("c", 3), row("d", 2), row("e", 1)];
    const out = foldSources(rows, 2, range(rows));
    expect(out).toHaveLength(3);
    const other = out[2]!;
    expect(other.value).toBe(OTHER_VALUE);
    expect(other.bucket).toBeNull();
    expect(other.foldedCount).toBe(3);
    expect(other.orders).toBe(6);
    expect(other.revenue).toBe(60);
    expect(other.website + other.application).toBe(6);
    expect(out.reduce((a, r) => a + r.orders, 0)).toBe(24);
  });

  it("uses the RANGE totals past the query cap, so Other covers what was never returned", () => {
    const rows = [row("a", 10), row("b", 8)];
    const out = foldSources(rows, 1, { ...range(rows), orders: 100, revenue: 1000, values: 60 });
    expect(out[1]!.orders).toBe(90);
    expect(out[1]!.revenue).toBe(900);
    expect(out[1]!.foldedCount).toBe(59);
  });
});
