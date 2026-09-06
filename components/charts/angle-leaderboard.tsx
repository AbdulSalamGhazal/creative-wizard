import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { swatchColor } from "@/lib/palette";
import { usd } from "@/lib/format";
import type { AngleMixRow } from "@/db/queries/performance";

const LIMIT = 8;

/**
 * Top angles by spend as a ranked horizontal-bar leaderboard. A donut is wrong
 * for angles — a creative can carry several, so the slices overlap and never sum
 * to a meaningful whole. Ranked bars compare magnitudes honestly.
 */
export function AngleLeaderboard({ rows }: { rows: AngleMixRow[] }) {
  const sorted = [...rows]
    .filter((r) => r.spend > 0)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, LIMIT);
  const max = sorted.length ? sorted[0]!.spend : 0;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle className="text-sm">Angle mix</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col">
        {sorted.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-ink-3 text-sm">
            No spend on any angle in this window.
          </div>
        ) : (
          <ul className="flex-1 flex flex-col justify-around gap-2.5">
            {sorted.map((r) => (
              <li key={r.angle} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-ink-2" title={r.angle}>
                    {r.angle}
                  </span>
                  <span className="num text-ink shrink-0">{usd(r.spend)}</span>
                </div>
                <div className="h-2 w-full rounded-full bg-surface-2 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${max > 0 ? (r.spend / max) * 100 : 0}%`,
                      background: swatchColor(r.angle),
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
