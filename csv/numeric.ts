/**
 * The tolerant numeric reading the CSV adapters do — lifted out of
 * `csv/pipeline.ts` so surfaces OUTSIDE the ingestion pipeline can share it
 * without dragging in the adapter registry and SheetJS. The pipeline still
 * owns the behaviour; this is the same code, in a module a client component
 * can import.
 *
 * "Blank means zero" is a system-wide convention, so the empty markers live
 * here too: a real spreadsheet says "—" or "n/a" as often as it says nothing.
 */

/** `""`, `-`, `—`, `n/a`, `null` — all of them mean "nothing here". */
export function isEmptyMarker(s: string): boolean {
  if (s === "") return true;
  const v = s.trim().toLowerCase();
  return v === "" || v === "-" || v === "—" || v === "n/a" || v === "null";
}

/** A comma is a THOUSANDS separator or nothing: `1,234` / `1,234.5`, never `12,50`. */
const GROUPED = /^[-+]?\d{1,3}(?:,\d{3})+(?:\.\d*)?$/;
/** A lone magnitude suffix — `5K`, `1.2M` — is not a unit to strip. */
const MAGNITUDE_SUFFIX = /\d\s*[kmb]$/i;

/**
 * Parse `"1,234.56"` / `"$1,234"` / `"1234 USD"` to 1234.56. Returns null on
 * failure — and on a cell it would have to GUESS at (2026-10-31): a comma
 * that isn't a thousands separator (`12,50` read as 1250, `1.234,56` as
 * 1.23456) or a magnitude suffix (`5K` read as 5). validation-spec §5.1: the
 * decimal point is the only decimal separator; such a cell is an E040, never
 * a number 100× off.
 */
export function parseNumber(raw: string): number | null {
  if (isEmptyMarker(raw)) return null;
  let cleaned = raw.trim();
  // strip leading currency symbols
  cleaned = cleaned.replace(/^[$£€¥]+/u, "");
  if (MAGNITUDE_SUFFIX.test(cleaned)) return null;
  // strip trailing unit / currency strings ("USD", "EGP", etc.)
  cleaned = cleaned.replace(/[\sA-Za-z]+$/u, "");
  // strip thousand-separators — only where they ARE thousand-separators
  if (cleaned.includes(",")) {
    if (!GROUPED.test(cleaned)) return null;
    cleaned = cleaned.replace(/,/g, "");
  }
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
