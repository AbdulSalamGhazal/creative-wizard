import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { rateBlock, RATING_VALUES, type Rating, type RatingConfig } from "@/lib/rating";
import { usdCompact } from "@/lib/format";
import type { CreativePoint } from "@/db/queries/performance";

const COLOR: Record<Rating, string> = {
  good: "var(--pos)",
  decent: "var(--warn)",
  bad: "var(--neg)",
  na: "var(--ink-3)",
};
const LABEL: Record<Rating, string> = {
  good: "Good",
  decent: "Decent",
  bad: "Bad",
  na: "N/A",
};

/**
 * How spend splits across performance ratings (Good / Decent / Bad / N/A) using
 * the brand's ROAS-based rating rules — i.e. what share of money is working. A
 * 100%-stacked bar of spend + a legend with each rating's spend and share.
 */
export function RatingDistribution({
  points,
  config,
}: {
  points: CreativePoint[];
  config: RatingConfig;
}) {
  const rules = config.default;
  const spend: Record<Rating, number> = { good: 0, decent: 0, bad: 0, na: 0 };
  let total = 0;
  for (const p of points) {
    const r = rateBlock({ spend: p.spend, roas: p.roas }, rules);
    spend[r] += p.spend;
    total += p.spend;
  }

  return (
    <Card className="bg-surface border-line h-full flex flex-col">
      <CardHeader>
        <CardTitle className="text-sm">Spend by rating</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-center gap-4">
        {total <= 0 ? (
          <div className="flex-1 flex items-center justify-center text-ink-3 text-sm">
            No spend in this window.
          </div>
        ) : (
          <>
            <div className="flex h-3.5 w-full rounded-full overflow-hidden bg-surface-2">
              {RATING_VALUES.map((r) => {
                const frac = total > 0 ? spend[r] / total : 0;
                if (frac <= 0) return null;
                return (
                  <span
                    key={r}
                    title={`${LABEL[r]}: ${usdCompact(spend[r])}`}
                    style={{ width: `${frac * 100}%`, background: COLOR[r] }}
                  />
                );
              })}
            </div>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              {RATING_VALUES.map((r) => (
                <li key={r} className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ background: COLOR[r] }}
                  />
                  <span className="text-ink-2 flex-1">{LABEL[r]}</span>
                  <span className="num text-ink">{usdCompact(spend[r])}</span>
                  <span className="num text-ink-3 w-9 text-right">
                    {Math.round((spend[r] / total) * 100)}%
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
