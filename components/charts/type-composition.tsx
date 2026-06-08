import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ALL_PLATFORMS,
  PLATFORM_COLOR,
  PLATFORM_LABEL,
  TYPE_LABEL,
} from "@/lib/palette";
import { usd } from "@/lib/format";
import type { TypePlatformSpendRow } from "@/db/queries/performance";

type CreativeType = "video" | "image" | "slides";

/**
 * Spend by creative type, each shown with its total and a stacked bar split by
 * platform — so you read the magnitude of each type and how it splits across
 * channels at a glance. Replaces the old type-mix donut.
 */
export function TypeCompositionChart({ rows }: { rows: TypePlatformSpendRow[] }) {
  const byType = new Map<string, { total: number; byPlatform: Map<string, number> }>();
  const present = new Set<string>();
  for (const r of rows) {
    let t = byType.get(r.type);
    if (!t) {
      t = { total: 0, byPlatform: new Map() };
      byType.set(r.type, t);
    }
    t.total += r.spend;
    t.byPlatform.set(r.platform, (t.byPlatform.get(r.platform) ?? 0) + r.spend);
    if (r.spend > 0) present.add(r.platform);
  }
  const types = [...byType.entries()]
    .filter(([, v]) => v.total > 0)
    .sort((a, b) => b[1].total - a[1].total);
  const legend = ALL_PLATFORMS.filter((p) => present.has(p));

  return (
    <Card className="bg-surface border-line h-full flex flex-col">
      <CardHeader>
        <CardTitle className="text-sm">Type mix</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-4">
        {types.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-ink-3 text-sm">
            No spend in this window.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {legend.map((p) => (
                <span
                  key={p}
                  className="inline-flex items-center gap-1.5 text-[11px] text-ink-3"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: PLATFORM_COLOR[p] }}
                  />
                  {PLATFORM_LABEL[p]}
                </span>
              ))}
            </div>

            <div className="flex-1 flex flex-col justify-around gap-4">
              {types.map(([type, v]) => (
                <div key={type} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink">{TYPE_LABEL[type as CreativeType]}</span>
                    <span className="num text-ink-2">{usd(v.total)}</span>
                  </div>
                  <div className="flex h-3 w-full rounded-full overflow-hidden bg-surface-2">
                    {ALL_PLATFORMS.filter((p) => (v.byPlatform.get(p) ?? 0) > 0).map(
                      (p) => {
                        const s = v.byPlatform.get(p)!;
                        const frac = v.total > 0 ? s / v.total : 0;
                        return (
                          <span
                            key={p}
                            title={`${PLATFORM_LABEL[p]}: ${usd(s)}`}
                            style={{
                              width: `${frac * 100}%`,
                              background: PLATFORM_COLOR[p],
                            }}
                          />
                        );
                      },
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
