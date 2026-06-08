import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { swatchColor } from "@/lib/palette";
import { usd } from "@/lib/format";
import type { TagMixRow } from "@/db/queries/performance";

const LIMIT = 8;

/**
 * Top tags by spend as a ranked horizontal-bar leaderboard. A donut is wrong
 * for tags — a creative can carry several, so the slices overlap and never sum
 * to a meaningful whole. Ranked bars compare magnitudes honestly.
 */
export function TagLeaderboard({ rows }: { rows: TagMixRow[] }) {
  const sorted = [...rows]
    .filter((r) => r.spend > 0)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, LIMIT);
  const max = sorted.length ? sorted[0]!.spend : 0;

  return (
    <Card className="bg-surface border-line h-full flex flex-col">
      <CardHeader>
        <CardTitle className="text-sm">Tag mix</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col">
        {sorted.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-ink-3 text-sm">
            No tagged spend in this window.
          </div>
        ) : (
          <ul className="flex-1 flex flex-col justify-around gap-2.5">
            {sorted.map((r) => (
              <li key={r.tag} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-ink-2" title={r.tag}>
                    {r.tag}
                  </span>
                  <span className="num text-ink shrink-0">{usd(r.spend)}</span>
                </div>
                <div className="h-2 w-full rounded-full bg-surface-2 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${max > 0 ? (r.spend / max) * 100 : 0}%`,
                      background: swatchColor(r.tag),
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
