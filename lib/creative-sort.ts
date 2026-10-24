import { creativeSortValues, type CreativeSort } from "@/validators/creative";
import { STATUS_ORDER, type CreativeStatus } from "@/lib/creative-status";
import { comparePriority } from "@/lib/priority";
import { compareStages } from "@/lib/funnel-stages";

/**
 * THE Library order (2026-10, W2-4 + D12). One pure comparator for every
 * `?sort=` value, used by the SERVER (`listCreatives`, and the detail page's
 * prev/next pager) and by the CLIENT when a sort click re-orders the rows it
 * already holds — so the three can never disagree. It used to be SQL `ORDER BY`
 * on the server plus three JS re-sorts, which also meant the order followed
 * the database's collation (en_US locally, whatever Neon's is in production).
 *
 * Text compares through ONE explicit collator, never the runtime's default
 * locale: the server and a browser set to Arabic must order the same names the
 * same way. Every sort ends on the name, so the order is total.
 */
const COLLATOR = new Intl.Collator("en");

/** The house text order for names, products and angles. */
export function compareText(a: string, b: string): number {
  return COLLATOR.compare(a, b);
}

/** What the comparator reads — a Library row has all of it. */
export interface CreativeSortRow {
  name: string;
  productName: string;
  type: string;
  status: CreativeStatus;
  launchDate: string | null;
  /** Angle names; the FIRST in text order is the angle sort key. */
  angles: readonly string[];
  spend7d: number;
  spend30d: number;
  priority: number | null;
  stages: readonly string[];
  createdAt: Date | string;
}

/** Null always LAST, in both directions (SQL's `NULLS LAST`). */
function nullsLast<V>(a: V | null, b: V | null, cmp: (x: V, y: V) => number, dir: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return cmp(a, b) * dir;
}

const isoCompare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const plainCompare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const firstAngle = (angles: readonly string[]): string | null =>
  angles.length === 0 ? null : [...angles].sort(compareText)[0]!;
const time = (v: Date | string) => (v instanceof Date ? v.getTime() : Date.parse(v));

/** The comparator for one sort value. */
export function creativeComparator(sort: CreativeSort): (a: CreativeSortRow, b: CreativeSortRow) => number {
  const byName = (a: CreativeSortRow, b: CreativeSortRow) => compareText(a.name, b.name);
  const then =
    (primary: (a: CreativeSortRow, b: CreativeSortRow) => number) =>
    (a: CreativeSortRow, b: CreativeSortRow) => {
      const d = primary(a, b);
      return d !== 0 ? d : byName(a, b);
    };
  switch (sort) {
    case "launched-desc":
      return then((a, b) => nullsLast(a.launchDate, b.launchDate, isoCompare, -1));
    case "launched-asc":
      return then((a, b) => nullsLast(a.launchDate, b.launchDate, isoCompare, 1));
    case "name-asc":
      return byName;
    case "name-desc":
      return (a, b) => -byName(a, b);
    case "product-asc":
      return then((a, b) => compareText(a.productName, b.productName));
    case "product-desc":
      return then((a, b) => -compareText(a.productName, b.productName));
    case "type-asc":
      return then((a, b) => plainCompare(a.type, b.type));
    case "type-desc":
      return then((a, b) => -plainCompare(a.type, b.type));
    case "status-asc":
      return then((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
    case "status-desc":
      return then((a, b) => STATUS_ORDER[b.status] - STATUS_ORDER[a.status]);
    // First angle in text order; creatives with no angle sort last.
    case "angle-asc":
      return then((a, b) => nullsLast(firstAngle(a.angles), firstAngle(b.angles), compareText, 1));
    case "angle-desc":
      return then((a, b) => nullsLast(firstAngle(a.angles), firstAngle(b.angles), compareText, -1));
    // A creative with no spend in the window reads $0 and sorts as 0.
    case "spend7-desc":
      return then((a, b) => b.spend7d - a.spend7d);
    case "spend7-asc":
      return then((a, b) => a.spend7d - b.spend7d);
    case "spend-desc":
      return then((a, b) => b.spend30d - a.spend30d);
    case "spend-asc":
      return then((a, b) => a.spend30d - b.spend30d);
    // Unrated / unassigned sort LAST in both directions (lib/priority, lib/funnel-stages).
    case "priority-desc":
      return then((a, b) => comparePriority(a.priority, b.priority, -1));
    case "priority-asc":
      return then((a, b) => comparePriority(a.priority, b.priority, 1));
    case "stage-asc":
      return then((a, b) => compareStages(a.stages, b.stages, 1));
    case "stage-desc":
      return then((a, b) => compareStages(a.stages, b.stages, -1));
    case "created-desc":
      return then((a, b) => time(b.createdAt) - time(a.createdAt));
  }
}

/** The Library's default order — the one a bare URL (no `?sort=`) shows. */
export const DEFAULT_CREATIVE_SORT: CreativeSort = "launched-desc";

/** A URL's `?sort=` read the way the server's validator reads it. */
export function parseCreativeSort(raw: string | null | undefined): CreativeSort {
  return creativeSortValues.includes(raw as CreativeSort) ? (raw as CreativeSort) : DEFAULT_CREATIVE_SORT;
}

/** A sorted COPY of `rows` — the server and the client both call this. */
export function sortCreativeRows<T extends CreativeSortRow>(rows: readonly T[], sort: CreativeSort): T[] {
  return [...rows].sort(creativeComparator(sort));
}
