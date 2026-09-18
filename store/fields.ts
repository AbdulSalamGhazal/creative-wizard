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

/**
 * SYSTEM-REQUIRED fields — a tier BETWEEN core and ordinary custom fields.
 *
 * Their values still live in `attributes` jsonb (they are not identity
 * columns, so core stays exactly the three), but every account has them, they
 * can't be deleted, and `required` can't be switched off. Label and accepted
 * headers stay editable — a store that calls the column "utm-source" just maps
 * it.
 *
 * "Required" here means the COLUMN must be present in every upload (S010).
 * Blank CELLS are fine and expected — plenty of orders genuinely have no UTM —
 * so the pipeline counts them instead of erroring (see `runStorePipeline`).
 */
export const SYSTEM_REQUIRED_KEYS = ["utm_source", "channel"] as const;
export type SystemRequiredKey = (typeof SYSTEM_REQUIRED_KEYS)[number];

const SYSTEM_REQUIRED_SET: ReadonlySet<string> = new Set(SYSTEM_REQUIRED_KEYS);
export function isSystemRequiredKey(key: string): key is SystemRequiredKey {
  return SYSTEM_REQUIRED_SET.has(key);
}

export interface SystemRequiredFieldDef {
  key: SystemRequiredKey;
  label: string;
  type: StoreFieldType;
  /** Default accepted headers; editable afterwards. */
  headers: string[];
  sortOrder: number;
}

/**
 * Definitions seeded per account — mirrored by migration 0046's promote/seed
 * (which KEEPS an existing field's label and headers rather than overwriting
 * them; only `required` is forced on).
 */
export const SYSTEM_REQUIRED_FIELDS: readonly SystemRequiredFieldDef[] = [
  {
    key: "utm_source",
    label: "UTM source",
    type: "text",
    headers: ["utm_source", "utm source"],
    sortOrder: 3,
  },
  {
    key: "channel",
    label: "Channel",
    type: "text",
    headers: ["channel"],
    sortOrder: 4,
  },
];

/**
 * The ONE field whose values drive platform attribution. Pinned in code since
 * 2026-09: `accounts.store_source_field_key` is backfilled to this and no
 * longer read (kept as a dead column, like `store_order_fields.show_in_table`).
 */
export const STORE_SOURCE_FIELD_KEY = "utm_source";

/** Insert-shaped core rows for an account (used by `createAccount`). */
export function coreFieldRows(accountId: string): Array<{
  accountId: string;
  key: string;
  label: string;
  type: StoreFieldType;
  required: boolean;
  headers: string[];
  sortOrder: number;
}> {
  return CORE_FIELDS.map((f) => ({
    accountId,
    key: f.key,
    label: f.label,
    type: f.type,
    required: true,
    headers: [],
    sortOrder: f.sortOrder,
  }));
}

/** Insert-shaped system-required rows for an account (used by `createAccount`). */
export function systemRequiredFieldRows(accountId: string): Array<{
  accountId: string;
  key: string;
  label: string;
  type: StoreFieldType;
  required: boolean;
  headers: string[];
  sortOrder: number;
}> {
  return SYSTEM_REQUIRED_FIELDS.map((f) => ({
    accountId,
    key: f.key,
    label: f.label,
    type: f.type,
    required: true,
    headers: [...f.headers],
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
  headers: string[];
  sortOrder: number;
  /** Convenience flag; core fields are locked in the config UI + actions. */
  core: boolean;
  /** Convenience flag; system-required fields can't be deleted or un-required. */
  systemRequired: boolean;
}
