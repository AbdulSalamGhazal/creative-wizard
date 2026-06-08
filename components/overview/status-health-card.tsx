import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CREATIVE_STATUSES, STATUS_DOT, STATUS_LABEL } from "@/lib/creative-status";
import type { CreativeStatusBreakdown } from "@/db/queries/creative-status";

/**
 * Library health by dynamic creative status (New / Active / Pause /
 * Terminated): a 100%-stacked bar + a legend with counts and shares. This is a
 * current-state view of the whole brand (it isn't scoped by the date window —
 * status is live).
 */
export function StatusHealthCard({
  breakdown,
}: {
  breakdown: CreativeStatusBreakdown;
}) {
  const { total, general } = breakdown;

  return (
    <Card className="bg-surface border-line h-full flex flex-col">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-sm">Creative status</CardTitle>
        <span className="text-[11px] text-ink-3 font-normal num">{total} total</span>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-center gap-4">
        {total === 0 ? (
          <div className="flex-1 flex items-center justify-center text-ink-3 text-sm">
            No creatives yet.
          </div>
        ) : (
          <>
            <div className="flex h-3 w-full rounded-full overflow-hidden bg-surface-2">
              {CREATIVE_STATUSES.map((s) => {
                const frac = total > 0 ? general[s] / total : 0;
                if (frac <= 0) return null;
                return (
                  <span
                    key={s}
                    title={`${STATUS_LABEL[s]}: ${general[s]}`}
                    style={{ width: `${frac * 100}%`, background: STATUS_DOT[s] }}
                  />
                );
              })}
            </div>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              {CREATIVE_STATUSES.map((s) => (
                <li key={s} className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ background: STATUS_DOT[s] }}
                  />
                  <span className="text-ink-2 flex-1">{STATUS_LABEL[s]}</span>
                  <span className="num text-ink">{general[s]}</span>
                  <span className="num text-ink-3 w-9 text-right">
                    {Math.round((general[s] / total) * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
