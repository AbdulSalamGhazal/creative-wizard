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

/** Parse `"1,234.56"` / `"$1,234"` / `"1234 USD"` to 1234.56. Returns null on failure. */
export function parseNumber(raw: string): number | null {
  if (isEmptyMarker(raw)) return null;
  let cleaned = raw.trim();
  // strip leading currency symbols
  cleaned = cleaned.replace(/^[$£€¥]+/u, "");
  // strip thousand-separators
  cleaned = cleaned.replace(/,/g, "");
  // strip trailing unit / currency strings ("USD", "EGP", etc.)
  cleaned = cleaned.replace(/[\sA-Za-z]+$/u, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
