import { z } from "zod";
import { platformEnum, creativeTypeEnum, creativeStatusEnum } from "@/db/schema";
import { RATING_VALUES, type Rating } from "@/lib/rating";

/**
 * URL-state validator for the Summary view.
 *
 * Extends the dashboard filter shape with:
 *  - `q` — free-text search on creative name (case-insensitive contains)
 *  - `creatorIds` — narrow to creatives authored by specific team members
 *  - `sort` / `dir` — column + direction
 *
 * The platform filter is **hard-capped to 3 server-side** — the table
 * renders three platform groups max, and a 4th would either get silently
 * dropped or break the layout. We clamp with `.slice(0, 3)` rather than
 * rejecting because URLs get shared and an invalid one shouldn't 500.
 */

function csvEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(Boolean) : []))
    .pipe(z.array(z.enum(values)))
    .catch([]);
}

function csv() {
  return z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(Boolean) : []));
}

export const MAX_PLATFORMS = 3;

/**
 * Hideable identity columns (the Creative-name column is mandatory — it's
 * the row identity, hiding it would leave anonymous rows of numbers).
 */
export const IDENTITY_COLUMN_KEYS = [
  "product",
  "type",
  "status",
  "creator",
] as const;
export type IdentityColumnKey = (typeof IDENTITY_COLUMN_KEYS)[number];

/**
 * Hideable metric columns. Toggling a metric hides it across every
 * platform group and the Blended Total group — per-platform granularity
 * isn't useful (you wouldn't want CTR for Meta but not for TikTok), and
 * 33 individual toggles would be unusable.
 */
export const METRIC_COLUMN_KEYS = [
  "spend",
  "impressions",
  "clicks",
  "conversions",
  "ctr",
  "cpm",
  "cpc",
  "cpa",
  "roas",
  "hook_rate",
  "hold_rate",
] as const;
export type MetricColumnKey = (typeof METRIC_COLUMN_KEYS)[number];

/**
 * Display metadata for each metric — drives the unit hint in the filter UI
 * and tells the query which metrics are stored as ratios (and so need
 * ×100 before comparing against a user-entered percentage).
 */
export type MetricUnit = "usd" | "int" | "pct" | "x";
export const METRIC_META: Record<
  MetricColumnKey,
  { label: string; unit: MetricUnit }
> = {
  spend: { label: "Spend", unit: "usd" },
  impressions: { label: "Impressions", unit: "int" },
  clicks: { label: "Clicks", unit: "int" },
  conversions: { label: "Conversions", unit: "int" },
  ctr: { label: "CTR", unit: "pct" },
  cpm: { label: "CPM", unit: "usd" },
  cpc: { label: "CPC", unit: "usd" },
  cpa: { label: "CPA", unit: "usd" },
  roas: { label: "ROAS", unit: "x" },
  hook_rate: { label: "Hook rate", unit: "pct" },
  hold_rate: { label: "Hold rate", unit: "pct" },
};

/** Numeric comparison operators for metric filters. */
export const METRIC_FILTER_OPS = ["gte", "lte", "eq"] as const;
export type MetricFilterOp = (typeof METRIC_FILTER_OPS)[number];

/**
 * Which column a numeric filter targets: the blended total across the
 * selected platforms, or one specific platform's column. `total` answers
 * "this creative's overall ROAS ≥ 2"; a platform scope answers "this
 * creative's Meta ROAS ≥ 2" — matching whichever column you're reading.
 */
export const METRIC_FILTER_SCOPES = [
  "total",
  "meta",
  "tiktok",
  "snapchat",
  "google",
] as const;
export type MetricFilterScope = (typeof METRIC_FILTER_SCOPES)[number];

export interface MetricFilterCondition {
  scope: MetricFilterScope;
  metric: MetricColumnKey;
  op: MetricFilterOp;
  /** Value in *display units* (e.g. 2 for "CTR ≥ 2%", 1.5 for "ROAS ≥ 1.5×"). */
  value: number;
}

/**
 * Parse the `metricFilters` URL param. Format: `scope:metric:op:value` items
 * joined by commas, e.g. `total:roas:gte:2,meta:spend:gte:500`.
 *
 * A 3-segment item (`metric:op:value`) is accepted for backward-compat and
 * defaults the scope to `total`.
 *
 * Invalid items are dropped silently (a shared/edited URL shouldn't 500).
 * Dedup is by scope+metric+op so "meta:spend:gte:100" + "meta:spend:lte:500"
 * coexist (a range) but a duplicate keeps only the first.
 *
 * Shared by the Zod schema (server) and the filter control (client) so the
 * encoding has exactly one definition.
 */
export function parseMetricFilters(
  raw: string | null | undefined,
): MetricFilterCondition[] {
  if (!raw) return [];
  const out: MetricFilterCondition[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const seg = part.split(":");
    let scope: string;
    let metric: string | undefined;
    let op: string | undefined;
    let rawValue: string | undefined;
    if (seg.length === 4) {
      [scope, metric, op, rawValue] = seg as [string, string, string, string];
    } else if (seg.length === 3) {
      scope = "total";
      [metric, op, rawValue] = seg as [string, string, string];
    } else {
      continue;
    }
    if (!(METRIC_FILTER_SCOPES as readonly string[]).includes(scope)) continue;
    if (!(METRIC_COLUMN_KEYS as readonly string[]).includes(metric!)) continue;
    if (!(METRIC_FILTER_OPS as readonly string[]).includes(op!)) continue;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) continue;
    const key = `${scope}:${metric}:${op}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      scope: scope as MetricFilterScope,
      metric: metric as MetricColumnKey,
      op: op as MetricFilterOp,
      value,
    });
  }
  return out;
}

export function serializeMetricFilters(arr: MetricFilterCondition[]): string {
  return arr.map((f) => `${f.scope}:${f.metric}:${f.op}:${f.value}`).join(",");
}

/**
 * The Rate filter: keep only creatives whose computed rating — on a chosen
 * scope (blended total or one platform) — is in the selected set. Encoded in
 * the URL as `rate=<scope>:<rating,rating>` e.g. `rate=total:good,decent`.
 * `ratings` empty means the filter is inactive (the scope is still remembered
 * so the picker keeps the user's choice).
 */
export interface RateFilterCondition {
  scope: MetricFilterScope;
  ratings: Rating[];
}

export function parseRateFilter(
  raw: string | null | undefined,
): RateFilterCondition | null {
  if (!raw) return null;
  const [scopeRaw, ratingsRaw] = raw.split(":");
  const scope: MetricFilterScope = (METRIC_FILTER_SCOPES as readonly string[]).includes(
    scopeRaw ?? "",
  )
    ? (scopeRaw as MetricFilterScope)
    : "total";
  const ratings = [
    ...new Set(
      (ratingsRaw ?? "")
        .split(",")
        .filter(Boolean)
        .filter((r): r is Rating =>
          (RATING_VALUES as readonly string[]).includes(r),
        ),
    ),
  ];
  return { scope, ratings };
}

export function serializeRateFilter(c: RateFilterCondition): string {
  return `${c.scope}:${c.ratings.join(",")}`;
}

/** Identity columns + per-platform metric keys. Validated against the
 *  selected platforms in the page; an invalid combination falls back to
 *  the default sort. */
export const SORT_DIRS = ["asc", "desc"] as const;
export type SortDir = (typeof SORT_DIRS)[number];

/** Free-form sort key. Validated against allowed shapes in the page; we
 *  accept any reasonable identifier here and let the page fall back if it
 *  references a hidden platform. */
const sortKeySchema = z
  .string()
  .regex(/^[a-z_]+(\.[a-z_]+)?$/i, "Invalid sort key")
  .max(48);

export const summaryFiltersSchema = z.object({
  from: z.string().date().optional().catch(undefined),
  to: z.string().date().optional().catch(undefined),
  q: z
    .string()
    .max(255)
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
  productIds: csv(),
  // Cap platforms at MAX_PLATFORMS — silently truncate so a copy-pasted
  // URL with four platforms still renders something coherent.
  platforms: csvEnum(platformEnum).transform((arr) =>
    arr.slice(0, MAX_PLATFORMS),
  ),
  types: csvEnum(creativeTypeEnum),
  statuses: csvEnum(creativeStatusEnum),
  tags: csv(),
  creatorIds: csv(),
  includeExcluded: z
    .string()
    .optional()
    .transform((s) => s === "1" || s === "true"),
  sort: sortKeySchema.optional(),
  dir: z.enum(SORT_DIRS).optional(),
  // Opt-out column visibility — URL only carries hidden columns, so the
  // default ("show everything") needs no URL params.
  hideIdentity: csvEnum(IDENTITY_COLUMN_KEYS),
  hideMetrics: csvEnum(METRIC_COLUMN_KEYS),
  // The Rate column is shown by default; `hideRate=1` opts out (boolean, so
  // it stays out of the per-metric hide list which is numeric-only).
  hideRate: z
    .string()
    .optional()
    .transform((s) => s === "1" || s === "true"),
  // Numeric metric filters applied to the blended total.
  metricFilters: z
    .string()
    .optional()
    .transform((s) => parseMetricFilters(s)),
  // Categorical Rate filter (scope + selected ratings).
  rate: z
    .string()
    .optional()
    .transform((s) => parseRateFilter(s)),
});

export type SummaryFilters = z.infer<typeof summaryFiltersSchema>;
