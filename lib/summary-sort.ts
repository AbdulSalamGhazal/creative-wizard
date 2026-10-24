import type { PlatformMetricBlock, SummaryRow } from "@/db/queries/summary";
import { STATUS_ORDER } from "@/lib/creative-status";
import { comparePriority } from "@/lib/priority";
import { compareStages } from "@/lib/funnel-stages";
import { RATING_RANK, rateBlock, rulesForScope, type RatingConfig } from "@/lib/rating";
import { compareText } from "@/lib/creative-sort";

/**
 * THE Ads table order (D12, 2026-10). One pure function for every `?sort=`
 * key, used by the SERVER (`listCreativeSummary`) and by the CLIENT when a
 * sort click re-orders the rows it already holds — a sort used to be a full
 * server render shipping ~2 KB per creative. It reproduces what the query's
 * `ORDER BY` and its five JS re-sorts did, rule for rule:
 *  - a metric sorts NULL as 0 (`coalesce(expr, 0)`), ties by name;
 *  - Rate, Status (general and per platform), Priority and Stage keep their
 *    own comparators (unrated / unassigned LAST both ways), ties by name;
 *  - a nullable identity (Creator, Launch date) follows Postgres: NULLs last
 *    ascending, first descending.
 * Names compare through the one house collator (`compareText`), never the
 * database's collation or the browser's locale.
 */

export type SummarySortDir = "asc" | "desc";
export interface SummarySort {
  key: string;
  dir: SummarySortDir;
}

/** Sort keys that are always valid (identity columns). */
export const SUMMARY_IDENTITY_SORT_KEYS: ReadonlySet<string> = new Set([
  "name",
  "product",
  "type",
  "status",
  "priority",
  "stage",
  "creator",
  "launch",
]);

/** Per-scope metric keys ("<platform | total>.<metric>"), and the block field each reads. */
export const SUMMARY_METRIC_FIELDS = {
  spend: "spend",
  impressions: "impressions",
  clicks: "clicks",
  conversions: "conversions",
  ctr: "ctr",
  cpm: "cpm",
  cpc: "cpc",
  cpa: "cpa",
  roas: "roas",
  hook_rate: "hookRate",
  hold_rate: "holdRate",
  complete_rate: "completeRate",
  landing_page_views: "landingPageViews",
  voc: "voc",
  cvr: "cvr",
} as const satisfies Record<string, keyof PlatformMetricBlock>;
export type SummaryMetricKey = keyof typeof SUMMARY_METRIC_FIELDS;

export const DEFAULT_SUMMARY_SORT: SummarySort = { key: "total.spend", dir: "desc" };

/**
 * Resolve a URL sort against the selected platforms. Unknown keys, and keys
 * for a platform that isn't selected, collapse to the default (total spend,
 * descending).
 */
export function resolveSummarySort(
  sort: string | null | undefined,
  dir: string | null | undefined,
  selectedPlatforms: readonly string[],
): SummarySort {
  const direction: SummarySortDir = dir === "asc" ? "asc" : "desc";
  if (!sort) return DEFAULT_SUMMARY_SORT;
  if (SUMMARY_IDENTITY_SORT_KEYS.has(sort)) return { key: sort, dir: direction };
  const [scope, metric] = sort.split(".");
  if (!scope || !metric) return DEFAULT_SUMMARY_SORT;
  // "rate" and "status" are derived categorical columns, sortable per scope.
  if (metric !== "rate" && metric !== "status" && !(metric in SUMMARY_METRIC_FIELDS)) {
    return DEFAULT_SUMMARY_SORT;
  }
  // The blended total has a Rate cell but no status chip.
  if (metric === "status" && scope === "total") return DEFAULT_SUMMARY_SORT;
  if (scope === "total" || selectedPlatforms.includes(scope)) return { key: sort, dir: direction };
  return DEFAULT_SUMMARY_SORT;
}

type Cmp = (a: SummaryRow, b: SummaryRow) => number;

const byName: Cmp = (a, b) => compareText(a.name, b.name);

/** Postgres text order with its NULL rule: last ascending, first descending. */
function nullableText(a: string | null, b: string | null, sign: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return sign === 1 ? 1 : -1;
  if (b === null) return sign === 1 ? -1 : 1;
  return compareText(a, b) * sign;
}

const blockOf = (row: SummaryRow, scope: string): PlatformMetricBlock | undefined =>
  scope === "total" ? row.total : row.perPlatform[scope as keyof SummaryRow["perPlatform"]];

/** The comparator for one resolved sort. */
export function summaryComparator(sort: SummarySort, ratingConfig: RatingConfig): Cmp {
  const sign: 1 | -1 = sort.dir === "asc" ? 1 : -1;
  const then =
    (primary: Cmp): Cmp =>
    (a, b) => {
      const d = primary(a, b);
      return d !== 0 ? d : byName(a, b);
    };
  switch (sort.key) {
    case "name":
      return (a, b) => byName(a, b) * sign || 0;
    case "product":
      return then((a, b) => compareText(a.productName, b.productName) * sign);
    case "type":
      return then((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0) * sign);
    case "creator":
      return then((a, b) => nullableText(a.creatorName, b.creatorName, sign));
    case "launch":
      return then((a, b) => nullableText(a.launchDate, b.launchDate, sign));
    case "status":
      return then((a, b) => (STATUS_ORDER[a.generalStatus] - STATUS_ORDER[b.generalStatus]) * sign);
    case "priority":
      return then((a, b) => comparePriority(a.priority, b.priority, sign));
    case "stage":
      return then((a, b) => compareStages(a.stages, b.stages, sign));
  }
  const [scope, metric] = sort.key.split(".") as [string, string];
  if (metric === "rate") {
    const rules = rulesForScope(ratingConfig, scope);
    const rank = (r: SummaryRow) => RATING_RANK[rateBlock(blockOf(r, scope), rules)];
    return then((a, b) => (rank(a) - rank(b)) * sign);
  }
  if (metric === "status") {
    const rank = (r: SummaryRow) =>
      STATUS_ORDER[r.perPlatformStatus[scope as keyof SummaryRow["perPlatformStatus"]] ?? "new"];
    return then((a, b) => (rank(a) - rank(b)) * sign);
  }
  const field = SUMMARY_METRIC_FIELDS[metric as SummaryMetricKey];
  const value = (r: SummaryRow) => (blockOf(r, scope)?.[field] as number | null | undefined) ?? 0;
  return then((a, b) => (value(a) - value(b)) * sign);
}

/** A sorted COPY of `rows` — the server and the client both call this. */
export function sortSummaryRows<T extends SummaryRow>(
  rows: readonly T[],
  sort: SummarySort,
  ratingConfig: RatingConfig,
): T[] {
  return [...rows].sort(summaryComparator(sort, ratingConfig));
}
