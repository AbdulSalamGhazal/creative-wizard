import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeltaBadge } from "@/components/kpi/delta-badge";
import type { Delta } from "@/lib/period";

/**
 * The canonical KPI tile. Replaces the inline tile blocks scattered across
 * Overview and Detail.
 *
 * `inverted` flips the delta-badge color semantics for metrics where ↓ is
 * better (CPA, CPM, CPC). Default ↑ = good.
 *
 * `caption` is the small secondary line under the value — usually the
 * filter window ("2026-04-28 → 2026-05-28") or, on Trends, the comparison
 * window ("vs prior 30d").
 */
export function KpiTile({
  label,
  value,
  delta,
  inverted = false,
  caption,
  dense = false,
}: {
  label: string;
  value: string;
  delta?: Delta;
  inverted?: boolean;
  caption?: string;
  /** Compact layout for many-in-a-row strips (smaller value, tighter padding,
   *  delta wraps under the value). */
  dense?: boolean;
}) {
  if (dense) {
    return (
      <Card className="bg-surface border-line">
        <CardContent className="p-3">
          <div className="text-[10px] uppercase tracking-[0.12em] text-ink-3 font-medium mb-1.5">
            {label}
          </div>
          <div className="font-display text-2xl num text-ink leading-none">
            {value}
          </div>
          {delta && (
            <div className="mt-1.5">
              <DeltaBadge delta={delta} inverted={inverted} />
            </div>
          )}
          {caption && <div className="text-[10px] text-ink-3 mt-1.5">{caption}</div>}
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="bg-surface border-line">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs uppercase tracking-[0.14em] text-ink-3 font-medium">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <div className="font-display text-4xl num text-ink leading-none">
            {value}
          </div>
          {delta && <DeltaBadge delta={delta} inverted={inverted} />}
        </div>
        {caption && (
          <div className="text-[11px] text-ink-3 mt-2">{caption}</div>
        )}
      </CardContent>
    </Card>
  );
}
