import {
  CREATIVE_STATUSES,
  STATUS_DOT,
  STATUS_LABEL,
} from "@/lib/creative-status";
import { ALL_PLATFORMS, PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import type { CreativeStatusBreakdown } from "@/db/queries/creative-status";

/**
 * Concise status stats under the Library title: the general (roll-up) status
 * breakdown, then a compact per-platform line (active / pause / terminated
 * counts for creatives present on each platform).
 */
export function CreativeStatusSummary({
  breakdown,
}: {
  breakdown: CreativeStatusBreakdown;
}) {
  const { total, general, perPlatform } = breakdown;

  return (
    <div className="mt-2 space-y-1.5">
      {/* General status breakdown */}
      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-sm num">
        <span className="text-ink-2">{total} total</span>
        {CREATIVE_STATUSES.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 text-ink-2">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: STATUS_DOT[s] }}
            />
            {general[s]} {STATUS_LABEL[s]}
          </span>
        ))}
      </div>

      {/* Per-platform: active / pause / terminated */}
      <div className="flex items-center flex-wrap gap-x-3.5 gap-y-1 text-xs num">
        {ALL_PLATFORMS.map((p) => {
          const c = perPlatform[p];
          return (
            <span
              key={p}
              className="inline-flex items-center gap-1"
              title={`${PLATFORM_LABEL[p]}: ${c.new} new · ${c.active} active · ${c.pause} pause · ${c.terminated} terminated`}
            >
              <span className="font-medium" style={{ color: PLATFORM_COLOR[p] }}>
                {PLATFORM_LABEL[p]}
              </span>
              <span className="inline-flex items-center gap-0.5">
                <span style={{ color: STATUS_DOT.new }}>{c.new}</span>
                <span className="text-ink-3">/</span>
                <span style={{ color: STATUS_DOT.active }}>{c.active}</span>
                <span className="text-ink-3">/</span>
                <span style={{ color: STATUS_DOT.pause }}>{c.pause}</span>
                <span className="text-ink-3">/</span>
                <span style={{ color: STATUS_DOT.terminated }}>
                  {c.terminated}
                </span>
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
