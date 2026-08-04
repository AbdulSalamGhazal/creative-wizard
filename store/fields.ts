/**
 * Store-order field model — the single source of truth for the Store module's
 * fields, parallel to (and independent of) the ads pipeline's
 * `csv/platforms/types.ts`.
 *
 * The grain is one row per order. Exactly THREE fields are core
 * (`order_id`/`order_date`/`total_amount`), seeded per account and LOCKED by
 * `CORE_KEYS`: their key/type/required cannot change — only their label and
 * accepted file `headers`. Everything else is an admin-defined custom field
 * whose values land in `store_orders.attributes` keyed by the field's `key`.
 * Mapping is EXPLICIT (accepted headers, case-insensitive after trim) — never
 * auto-detected. Money is SAR throughout; never converted to USD here.
 */

export type StoreFieldType = "text" | "number" | "date";

/** The three locked core keys. Their config rows exist per account. */
export const CORE_KEYS = ["order_id", "order_date", "total_amount"] as const;
export type CoreKey = (typeof CORE_KEYS)[number];

const CORE_SET: ReadonlySet<string> = new Set(CORE_KEYS);
export function isCoreKey(key: string): key is CoreKey {
  return CORE_SET.has(key);
}

export interface CoreFieldDef {
  key: CoreKey;
  label: string;
  type: StoreFieldType;
  sortOrder: number;
}

/** Core field definitions — mirrors the migration seed + createAccount seed. */
export const CORE_FIELDS: readonly CoreFieldDef[] = [
  { key: "order_id", label: "Order ID", type: "text", sortOrder: 0 },
  { key: "order_date", label: "Order date", type: "date", sortOrder: 1 },
  { key: "total_amount", label: "Total amount", type: "number", sortOrder: 2 },
];

/** Insert-shaped core rows for an account (used by `createAccount`). */
export function coreFieldRows(accountId: string): Array<{
  accountId: string;
  key: string;
  label: string;
  type: StoreFieldType;
  required: boolean;
  showInTable: boolean;
  headers: string[];
  sortOrder: number;
}> {
  return CORE_FIELDS.map((f) => ({
    accountId,
    key: f.key,
    label: f.label,
    type: f.type,
    required: true,
    showInTable: true,
    headers: [],
    sortOrder: f.sortOrder,
  }));
}

/**
 * Slugify a label into a stable field key: lowercase, non-alphanumerics → `_`,
 * collapsed, trimmed, capped at 48 chars. Empty/degenerate → "field".
 */
export function slugifyKey(label: string): string {
  const base = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48)
    .replace(/_+$/g, "");
  return base || "field";
}

/** A field config row as consumed by the pipeline + table (core or custom). */
export interface StoreField {
  id: string;
  key: string;
  label: string;
  type: StoreFieldType;
  required: boolean;
  showInTable: boolean;
  headers: string[];
  sortOrder: number;
  /** Convenience flag; core fields are locked in the config UI + actions. */
  core: boolean;
}
