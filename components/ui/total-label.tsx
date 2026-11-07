import { InfoTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

/**
 * THE label of a table's totals row (R-098): "Total", everywhere, with the
 * weighting rule in an ⓘ instead of in the label ("Totals · weighted" on one
 * table implied the others were not — every blended figure in the app is).
 * `suffix` carries a count the table has nowhere else to show.
 */
export function TotalLabel({
  suffix,
  className,
}: {
  suffix?: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      Total
      {suffix && <span className="font-normal text-ink-3">· {suffix}</span>}
      <InfoTip label="How totals are computed">
        Rates and averages in this row are computed from the column sums (for
        example total clicks ÷ total impressions), never averaged across rows.
      </InfoTip>
    </span>
  );
}
