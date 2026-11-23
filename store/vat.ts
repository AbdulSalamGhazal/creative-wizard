/**
 * Saudi VAT. Salla's line totals include it; gross profit is counted on sales
 * BEFORE VAT (user decision 2026-11-23: "the VAT isn't yours"). Plain module —
 * the order panel (client) and the COGS queries both read it.
 */
export const SAUDI_VAT_RATE = 0.15;

/** A VAT-inclusive SAR amount → the same amount before VAT, 2 decimals. */
export function beforeVat(inclVat: number): number {
  return Math.round((inclVat / (1 + SAUDI_VAT_RATE)) * 100) / 100;
}
