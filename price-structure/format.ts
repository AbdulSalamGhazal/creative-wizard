import type { MetricUnit } from "./engine/metrics";
import { METRICS } from "./engine/metrics";
import type { MetricKey } from "./engine/types";

/**
 * The module's number formats (brief §8.1). en-US grouping; a value that is
 * not finite renders as "—" (never a fabricated zero). The minus sign is the
 * typographic U+2212, like the rest of the app.
 */
export const DASH = "—";
const MINUS = "−";

const fixed = (dp: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const F0 = fixed(0);
const F1 = fixed(1);
const F2 = fixed(2);
const USD2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const USD0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });

const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** Intl writes "-" — swap for the typographic minus. */
const typo = (s: string) => s.replace("-", MINUS);

/** SAR money per order: 2 decimals, no unit (the column says SAR). */
export function money2(v: number | null | undefined): string {
  return finite(v) ? typo(F2.format(v)) : DASH;
}
/** SAR totals in tiles and plan tables: 0 decimals. */
export function money0(v: number | null | undefined): string {
  return finite(v) ? typo(F0.format(v)) : DASH;
}
export function sar2(v: number | null | undefined): string {
  return finite(v) ? `${money2(v)} SAR` : DASH;
}
export function sar0(v: number | null | undefined): string {
  return finite(v) ? `${money0(v)} SAR` : DASH;
}
/** A fraction as a percentage with 1 decimal: 0.2752 → "27.5%". */
export function pct1(v: number | null | undefined): string {
  return finite(v) ? `${typo(F1.format(v * 100))}%` : DASH;
}
/** A fraction as a percentage with 2 decimals (CML % and cost shares in tables). */
export function pct2(v: number | null | undefined): string {
  return finite(v) ? `${typo(F2.format(v * 100))}%` : DASH;
}
/** ROAS: 2 decimals, no "×". */
export function roas2(v: number | null | undefined): string {
  return finite(v) ? typo(F2.format(v)) : DASH;
}
/** ROAS with the unit, for axes and ladder labels. */
export function roasX(v: number | null | undefined): string {
  return finite(v) ? `${roas2(v)}×` : DASH;
}
export function usd2(v: number | null | undefined): string {
  return finite(v) ? typo(USD2.format(v)) : DASH;
}
export function usd0(v: number | null | undefined): string {
  return finite(v) ? typo(USD0.format(v)) : DASH;
}
export function int0(v: number | null | undefined): string {
  return finite(v) ? typo(F0.format(v)) : DASH;
}
/** Up to 2 decimals, trailing zeros dropped: 6.666 → "6.67", 21 → "21". */
export function num2(v: number | null | undefined): string {
  return finite(v)
    ? typo(new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(v))
    : DASH;
}

const sign = (v: number) => (v > 0 ? "+" : v < 0 ? MINUS : "");

/** A relative change: +12.0% / −18.4% (1 decimal). */
export function signedPct1(v: number | null | undefined): string {
  if (!finite(v)) return DASH;
  const s = F1.format(Math.abs(v) * 100);
  return `${s === "0.0" ? "" : sign(v)}${s}%`;
}
/** A percentage-point change: +3.4 pp / −3.4 pp. */
export function pp1(v: number | null | undefined): string {
  if (!finite(v)) return DASH;
  const s = F1.format(Math.abs(v) * 100);
  return `${s === "0.0" ? "" : sign(v)}${s} pp`;
}

/** A metric's value in its own unit, for tiles, badges and target text. */
export function formatUnit(unit: MetricUnit, v: number | null | undefined, opts: { pctDp?: 1 | 2; whole?: boolean } = {}): string {
  switch (unit) {
    case "pct":
      return opts.pctDp === 2 ? pct2(v) : pct1(v);
    case "sar":
      return opts.whole ? money0(v) : money2(v);
    case "x":
      return roas2(v);
    case "usd":
      return usd2(v);
  }
}

export function formatMetric(key: MetricKey, v: number | null | undefined, opts: { pctDp?: 1 | 2 } = {}): string {
  const meta = METRICS[key];
  return formatUnit(meta.unit, v, { pctDp: opts.pctDp, whole: meta.monthly });
}

/** "{metric short} {value}": "CML % 25.0%", "CML / order 60.00". */
export function targetText(key: MetricKey, v: number): string {
  return `${METRICS[key].short} ${formatMetric(key, v)}`;
}

/** Input ↔ stored value for a metric unit: % fields are typed as 25 and stored as 0.25. */
export function toInput(unit: MetricUnit, stored: number): number {
  return unit === "pct" ? Math.round(stored * 1e6) / 1e4 : stored;
}
export function fromInput(unit: MetricUnit, typed: number): number {
  return unit === "pct" ? typed / 100 : typed;
}
