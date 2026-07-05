const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const intFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const ratioFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usd0Formatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const usd1Formatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const usdCompactFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const intCompactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const EM_DASH = "—";

export function usd(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EM_DASH;
  return usdFormatter.format(value);
}

export function int(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EM_DASH;
  return intFormatter.format(value);
}

export function pct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EM_DASH;
  return percentFormatter.format(value);
}

export function ratio(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EM_DASH;
  return ratioFormatter.format(value);
}

/**
 * ROAS as a ×-suffixed ratio (e.g. "8.50×"). The suffix is part of the metric's
 * identity — render ROAS through this everywhere so it never shows as a bare
 * number that reads like a dollar figure. Null/NaN → em-dash.
 */
export function roas(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EM_DASH;
  return `${ratioFormatter.format(value)}×`;
}

/** Currency with no cents (e.g. "$123,456"). */
export function usd0(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EM_DASH;
  return usd0Formatter.format(value);
}

/** Currency with one decimal (e.g. "$12.3"). */
export function usd1(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EM_DASH;
  return usd1Formatter.format(value);
}

/** Compact currency for tight spaces (e.g. "$1.2M", "$8.4K"). */
export function usdCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EM_DASH;
  return usdCompactFormatter.format(value);
}

/** Compact integer for tight spaces (e.g. "1.2M", "8.4K"). */
export function intCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EM_DASH;
  return intCompactFormatter.format(value);
}

export function isoDate(value: Date | string | null | undefined): string {
  if (!value) return EM_DASH;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return EM_DASH;
  return d.toISOString().slice(0, 10);
}

/**
 * Compact relative time ("just now", "3m ago", "2h ago", "5d ago"). Falls
 * back to an ISO date past 30 days so the feed stays readable on older items.
 */
export function relativeTime(value: Date | string | null | undefined): string {
  if (!value) return EM_DASH;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return EM_DASH;
  const diffMs = Date.now() - d.getTime();
  const s = Math.round(diffMs / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days}d ago`;
  return isoDate(d);
}
