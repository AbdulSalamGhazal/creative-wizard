import { cn } from "@/lib/utils";
import { money0, money2, pct1, pct2, roas2, usd0, usd2 } from "@/price-structure/format";

export type NumKind = "money2" | "money0" | "pct1" | "pct2" | "roas" | "usd2" | "usd0";

const FORMAT: Record<NumKind, (v: number | null | undefined) => string> = {
  money2,
  money0,
  pct1,
  pct2,
  roas: roas2,
  usd2,
  usd0,
};

export function formatNum(kind: NumKind, value: number | null | undefined): string {
  return FORMAT[kind](value);
}

/**
 * A number in a table or grid: tabular figures, a dash for anything not
 * finite, red when negative (brief §8.2) and a title that explains it.
 */
export function Num({
  value,
  kind,
  title,
  className,
  red = true,
}: {
  value: number | null | undefined;
  kind: NumKind;
  title?: string;
  className?: string;
  /** Colour negatives red (off for a column where negative is fine). */
  red?: boolean;
}) {
  const negative = red && typeof value === "number" && Number.isFinite(value) && value < 0;
  return (
    <span title={title} className={cn("num tabular-nums", negative && "text-neg", className)}>
      {formatNum(kind, value)}
    </span>
  );
}
