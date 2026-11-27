/**
 * Salla's payment-method slugs as the feed stores them in
 * `attributes.payment_method`. The stored value stays the slug; this is only
 * how a page words it. Plain module — Insights (client) and the MCP read it.
 */
const KNOWN_PAYMENT_LABELS: Record<string, string> = {
  cod: "Cash on delivery",
  tamara_installment: "Tamara",
  tabby_installment: "Tabby",
  mada: "mada",
  credit_card: "Credit card",
  apple_pay: "Apple Pay",
  stc_pay: "STC Pay",
  bank: "Bank transfer",
  waiting: "Awaiting payment",
};

/** A known slug reads as its name; an unknown one is humanized, never hidden. */
export function paymentMethodLabel(slug: string): string {
  const known = KNOWN_PAYMENT_LABELS[slug.toLowerCase()];
  if (known) return known;
  const s = slug.replace(/[_-]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : slug;
}
