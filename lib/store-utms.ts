import {
  ALL_PLATFORMS,
  PLATFORM_COLOR,
  PLATFORM_LABEL,
  type PlatformKey,
} from "@/lib/palette";
import { NO_SOURCE, OTHER_SOURCE, UNMAPPED_SOURCE } from "@/store/sources";
import { reconDelta, reconDeltaPct, reconMatchRate } from "@/lib/reconciliation";
import { OTHER_VALUE, dimensionNoun, share } from "@/lib/store-insights";
import type { RangeBucket } from "@/lib/budget";

/**
 * Store → UTMs — the pure half (no React, no SQL): the bucket vocabulary, the
 * coverage sums, the series bucketing, the half-vs-half trend, the spelling
 * variant finder and the per-platform accuracy math.
 *
 * The page compares store UTM orders with platform-claimed conversions —
 * COUNTS ONLY, like Reconciliation (store revenue is SAR, platform value is
 * USD, and the system holds no exchange rate). Every platform number here is
 * derived through `lib/reconciliation.ts`, never re-derived, so the three
 * store pages can never disagree about a platform's gap.
 */

// ── Buckets ──────────────────────────────────────────────────────────────────

/** Where an order's `utm_source` lands: a platform, or one of three "unknowns". */
export type UtmBucket =
  | PlatformKey
  | typeof OTHER_SOURCE
  | typeof UNMAPPED_SOURCE
  | typeof NO_SOURCE;

/** Display order: platforms as the house lists them, then the three unknowns. */
export const UTM_BUCKETS: readonly UtmBucket[] = [
  ...ALL_PLATFORMS,
  OTHER_SOURCE,
  UNMAPPED_SOURCE,
  NO_SOURCE,
];

export function isPlatformBucket(bucket: string): bucket is PlatformKey {
  return (ALL_PLATFORMS as readonly string[]).includes(bucket);
}

export function isUtmBucket(value: string): value is UtmBucket {
  return (UTM_BUCKETS as readonly string[]).includes(value);
}

export function utmBucketLabel(bucket: UtmBucket): string {
  if (isPlatformBucket(bucket)) return PLATFORM_LABEL[bucket];
  if (bucket === OTHER_SOURCE) return "Other sources";
  if (bucket === UNMAPPED_SOURCE) return "Unmapped";
  return "No UTM";
}

/**
 * Chart fills. Platforms keep their house colours; the three unknowns are told
 * apart by weight — "Other sources" is a real answer (the darker neutral),
 * "Unmapped" is a fixable gap (the warn amber), "No UTM" is the lighter
 * neutral because it is the absence of an answer.
 */
export function utmBucketColor(bucket: UtmBucket): string {
  if (isPlatformBucket(bucket)) return PLATFORM_COLOR[bucket];
  if (bucket === OTHER_SOURCE) return "var(--ink-2)";
  if (bucket === UNMAPPED_SOURCE) return "var(--warn)";
  return "var(--ink-3)";
}

// ── Coverage ─────────────────────────────────────────────────────────────────

export interface UtmBucketDay {
  day: string;
  bucket: UtmBucket;
  orders: number;
  revenue: number;
}

export interface UtmCoverage {
  orders: number;
  revenue: number;
  /** Orders whose source maps to an ad platform (Σ of `byPlatform`). */
  ads: number;
  /** Orders whose source is explicitly "not an ad platform". */
  other: number;
  /** Orders with a source value nobody has mapped. */
  unmapped: number;
  /** Orders with no source at all. */
  blank: number;
  byPlatform: Record<PlatformKey, number>;
}

/**
 * Range totals from the per-day bucket rows — COMPONENT SUMS; every share on
 * the page is a part over these totals, never a mean of per-day shares.
 * `ads + other + unmapped + blank === orders` by construction.
 */
export function utmCoverage(rows: readonly UtmBucketDay[]): UtmCoverage {
  const byPlatform = Object.fromEntries(
    ALL_PLATFORMS.map((p) => [p, 0]),
  ) as Record<PlatformKey, number>;
  const c: UtmCoverage = {
    orders: 0,
    revenue: 0,
    ads: 0,
    other: 0,
    unmapped: 0,
    blank: 0,
    byPlatform,
  };
  for (const r of rows) {
    c.orders += r.orders;
    c.revenue += r.revenue;
    if (isPlatformBucket(r.bucket)) {
      c.ads += r.orders;
      byPlatform[r.bucket] += r.orders;
    } else if (r.bucket === OTHER_SOURCE) c.other += r.orders;
    else if (r.bucket === UNMAPPED_SOURCE) c.unmapped += r.orders;
    else c.blank += r.orders;
  }
  return c;
}

export { share };

// ── Sources ──────────────────────────────────────────────────────────────────

export interface UtmSourceRow {
  /** The raw `utm_source`, or NULL for the blank bucket. */
  value: string | null;
  bucket: UtmBucket;
  orders: number;
  revenue: number;
  /** Orders whose channel maps to Website. */
  website: number;
  /** Orders whose channel maps to Application. */
  application: number;
}

export interface FoldedSourceRow extends Omit<UtmSourceRow, "bucket"> {
  /** NULL on the "Other" fold — it stands for values in several buckets. */
  bucket: UtmBucket | null;
  /** How many values this row stands for — > 1 only for the fold. */
  foldedCount: number;
}

export { OTHER_VALUE };

/**
 * Top-N sources by orders with the tail folded into ONE "Other" row — the
 * Insights fold, carrying the channel split too. Other is the RANGE total
 * minus what is shown (the query caps groups, so the returned tail alone can
 * under-count), which keeps every column summing to the range by construction.
 */
export function foldSources(
  rows: readonly UtmSourceRow[],
  limit: number,
  range: { orders: number; revenue: number; website: number; application: number; values: number },
): FoldedSourceRow[] {
  const byOrders = [...rows].sort((a, b) => b.orders - a.orders || b.revenue - a.revenue);
  const values = Math.max(range.values, byOrders.length);
  if (values <= limit) return byOrders.map((r) => ({ ...r, foldedCount: 1 }));
  const head = byOrders.slice(0, limit).map((r): FoldedSourceRow => ({ ...r, foldedCount: 1 }));
  const sum = (pick: (r: UtmSourceRow) => number) =>
    head.reduce((a, r) => a + pick(r as UtmSourceRow), 0);
  return [
    ...head,
    {
      value: OTHER_VALUE,
      bucket: null,
      orders: Math.max(0, range.orders - sum((r) => r.orders)),
      revenue: Math.max(0, Math.round((range.revenue - sum((r) => r.revenue)) * 100) / 100),
      website: Math.max(0, range.website - sum((r) => r.website)),
      application: Math.max(0, range.application - sum((r) => r.application)),
      foldedCount: values - head.length,
    },
  ];
}

// ── Series ───────────────────────────────────────────────────────────────────

export interface KeyedDay {
  day: string;
  key: string;
  orders: number;
  revenue: number;
}

export interface SeriesPoint {
  key: string;
  label: string;
  /** series key → the metric's value in this bucket. */
  values: Record<string, number>;
}

/**
 * Roll per-day keyed rows into the chosen buckets (Pacing's own range-clipped
 * day/week/month helpers — never a second week definition). Every requested
 * series key is present in every point (0 when absent), so a stacked chart
 * never gets a hole.
 */
export function bucketizeSeries(
  rows: readonly KeyedDay[],
  buckets: readonly RangeBucket[],
  keys: readonly string[],
  metric: "orders" | "revenue",
): SeriesPoint[] {
  const wanted = new Set(keys);
  return buckets.map((b) => {
    const values: Record<string, number> = {};
    for (const k of keys) values[k] = 0;
    for (const r of rows) {
      if (!wanted.has(r.key)) continue;
      if (r.day >= b.start && r.day <= b.end) {
        values[r.key] = (values[r.key] ?? 0) + r[metric];
      }
    }
    return { key: b.key, label: b.label, values };
  });
}

// ── Half-vs-half trend ───────────────────────────────────────────────────────

export interface HalfTrend {
  /** Orders per day in the first half of the range. */
  firstPerDay: number;
  /** Orders per day in the second half. */
  secondPerDay: number;
  /** (second − first) / first, per day — NULL when the first half had none. */
  pct: number | null;
}

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
const plusDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/**
 * Did this series grow or shrink INSIDE the range? The range is cut at its
 * midpoint and the two halves are compared PER DAY, so an odd day count (and
 * the longer second half it gives) can't manufacture a trend. The page
 * measures only the selected range — there is still no period comparison
 * against an earlier window, the Store module's standing decision.
 */
export function halfSplitTrend(
  daily: ReadonlyArray<{ day: string; orders: number }>,
  range: { from: string; to: string },
): HalfTrend {
  const days = Math.max(1, daysBetween(range.from, range.to));
  const firstDays = Math.max(1, Math.floor(days / 2));
  const secondDays = Math.max(1, days - firstDays);
  const mid = plusDays(range.from, firstDays); // first day of the second half
  let first = 0;
  let second = 0;
  for (const d of daily) {
    if (d.day < range.from || d.day > range.to) continue;
    if (d.day < mid) first += d.orders;
    else second += d.orders;
  }
  const firstPerDay = first / firstDays;
  const secondPerDay = second / secondDays;
  return {
    firstPerDay,
    secondPerDay,
    pct: firstPerDay > 0 ? (secondPerDay - firstPerDay) / firstPerDay : null,
  };
}

// ── Spelling variants ────────────────────────────────────────────────────────

export interface SourceValue {
  value: string;
  orders: number;
  bucket: UtmBucket;
}

export interface SourceVariantGroup {
  /** The normalized form the members share. */
  key: string;
  members: SourceValue[];
  orders: number;
  /** Every member lands in the same bucket — the variants are at least consistent. */
  sameBucket: boolean;
}

/**
 * The normalized form of a source value: case, spaces and punctuation folded
 * away (`Instagram`, `instagram`, `insta-gram ` → `instagram`). Letters and
 * digits in any script survive, so Arabic values group too.
 */
export function normalizeSourceValue(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Values that differ only in case, spacing or punctuation — the tagging
 * mistakes that silently split one source into several rows. Groups of two
 * or more, largest first. `sameBucket` says whether the split is already
 * harmless (all mapped to the same place) or is also an attribution gap.
 */
export function sourceVariants(values: readonly SourceValue[]): SourceVariantGroup[] {
  const groups = new Map<string, SourceValue[]>();
  for (const v of values) {
    const key = normalizeSourceValue(v.value);
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(v);
    else groups.set(key, [v]);
  }
  const out: SourceVariantGroup[] = [];
  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => b.orders - a.orders);
    out.push({
      key,
      members: sorted,
      orders: sorted.reduce((a, m) => a + m.orders, 0),
      sameBucket: sorted.every((m) => m.bucket === sorted[0]!.bucket),
    });
  }
  return out.sort((a, b) => b.orders - a.orders);
}

// ── Platform accuracy ────────────────────────────────────────────────────────

export interface PlatformAccuracyRow {
  platform: PlatformKey;
  /** Conversions the platform reported (Ads uploads), summed over the range. */
  claimed: number;
  /** Store orders whose `utm_source` maps to this platform. */
  utm: number;
  /** claimed − UTM orders (Reconciliation's inflation framing: + = over-claim). */
  delta: number;
  /** delta / UTM orders — NULL when there are no UTM orders. */
  deltaPct: number | null;
  /** claimed / UTM orders — "the platform claims N orders per UTM order". */
  ratio: number | null;
}

/**
 * One row per platform that has data on either side in range, in house
 * order. Δ, Δ% and the ratio come from `lib/reconciliation.ts`, so the sign
 * and the zero rule are Reconciliation's — never re-derived here.
 */
export function accuracyRows(
  utmByPlatform: Readonly<Record<string, number>>,
  claimedByPlatform: Readonly<Record<string, number>>,
  platforms: readonly PlatformKey[] = ALL_PLATFORMS,
): PlatformAccuracyRow[] {
  const out: PlatformAccuracyRow[] = [];
  for (const p of platforms) {
    const utm = utmByPlatform[p] ?? 0;
    const claimed = claimedByPlatform[p] ?? 0;
    if (utm === 0 && claimed === 0) continue;
    out.push({
      platform: p,
      claimed,
      utm,
      delta: reconDelta(utm, claimed),
      deltaPct: reconDeltaPct(utm, claimed),
      ratio: reconMatchRate(utm, claimed),
    });
  }
  return out;
}

/** The totals row: component sums, then the same helpers OVER the sums. */
export function sumAccuracy(rows: readonly PlatformAccuracyRow[]): Omit<PlatformAccuracyRow, "platform"> {
  const claimed = rows.reduce((a, r) => a + r.claimed, 0);
  const utm = rows.reduce((a, r) => a + r.utm, 0);
  return {
    claimed,
    utm,
    delta: reconDelta(utm, claimed),
    deltaPct: reconDeltaPct(utm, claimed),
    ratio: reconMatchRate(utm, claimed),
  };
}

// ── Compare ──────────────────────────────────────────────────────────────────

/** At most this many sources side by side — six series is where lines stop reading. */
export const COMPARE_MAX = 6;

/** Per-day series are fetched for the top N sources only; the rest fold into "Other". */
export const TOP_SOURCE_SERIES = 40;

/** A raw value's key in the URL and the series maps; the blank bucket has one too. */
export function sourceKey(value: string | null): string {
  return value ?? NO_SOURCE;
}

/** Inverse of `sourceKey`. */
export function sourceFromKey(key: string): string | null {
  return key === NO_SOURCE ? null : key;
}

/**
 * The `?compare=` param: comma-joined, each key URI-encoded so a value with a
 * comma survives the trip. Unknown keys (a source no longer in range) are
 * dropped, duplicates collapsed, the list capped.
 */
export function parseCompareParam(
  raw: string | null | undefined,
  available: ReadonlySet<string>,
): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    if (!part) continue;
    let key: string;
    try {
      key = decodeURIComponent(part);
    } catch {
      continue;
    }
    if (!available.has(key) || out.includes(key)) continue;
    out.push(key);
    if (out.length >= COMPARE_MAX) break;
  }
  return out;
}

export function encodeCompareParam(keys: readonly string[]): string {
  return keys.map((k) => encodeURIComponent(k)).join(",");
}

/**
 * What to compare before the user picks: the top N sources by orders, blank
 * excluded — so the section is useful on first load instead of an empty box.
 */
export function defaultCompare(
  sources: ReadonlyArray<{ value: string | null; orders: number }>,
  n = 3,
): string[] {
  return [...sources]
    .filter((s) => s.value !== null)
    .sort((a, b) => b.orders - a.orders)
    .slice(0, n)
    .map((s) => sourceKey(s.value));
}

/** How a source reads: its raw value, or the blank bucket named from the field's label. */
export function sourceLabel(value: string | null, fieldLabel: string): string {
  return value === null ? `No ${dimensionNoun(fieldLabel)}` : value;
}
