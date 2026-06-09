"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  CREATIVE_STATUSES,
  STATUS_DOT,
  STATUS_LABEL,
} from "@/lib/creative-status";
import { ALL_PLATFORMS, PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { cn } from "@/lib/utils";
import type { CreativeStatusBreakdown } from "@/db/queries/creative-status";

const csv = (v: string | null): string[] =>
  v ? v.split(",").filter(Boolean) : [];

/**
 * Status stats under the Library title. The overall (roll-up) row, then a
 * compact per-platform row. Every count is a click-to-filter chip: an overall
 * status applies `?statuses=<s>` (general status); a platform's status applies
 * `?platforms=<p>&statuses=<s>` (the Library scopes status to that single
 * platform). Clicking an already-applied chip clears it.
 */
export function CreativeStatusSummary({
  breakdown,
}: {
  breakdown: CreativeStatusBreakdown;
}) {
  const { total, general, perPlatform } = breakdown;
  const pathname = usePathname();
  const sp = useSearchParams();
  const curStatuses = csv(sp.get("statuses"));
  const curPlatforms = csv(sp.get("platforms"));

  const hrefFor = (statuses: string[], platforms: string[]): string => {
    const next = new URLSearchParams(sp.toString());
    if (statuses.length) next.set("statuses", statuses.join(","));
    else next.delete("statuses");
    if (platforms.length) next.set("platforms", platforms.join(","));
    else next.delete("platforms");
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  return (
    <div className="mt-3 space-y-2">
      {/* Overall (general status) */}
      <div className="flex items-center flex-wrap gap-1.5">
        <span className="text-sm text-ink-3 mr-0.5 num">{total} creatives</span>
        {CREATIVE_STATUSES.map((s) => {
          const active =
            curPlatforms.length === 0 &&
            curStatuses.length === 1 &&
            curStatuses[0] === s;
          return (
            <Link
              key={s}
              href={active ? hrefFor([], []) : hrefFor([s], [])}
              scroll={false}
              aria-pressed={active}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm num transition-colors",
                active
                  ? "border-line-2 bg-surface-2 text-ink"
                  : "border-transparent text-ink-2 hover:bg-surface-2 hover:text-ink",
              )}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: STATUS_DOT[s] }}
              />
              <span className="font-semibold text-ink">{general[s]}</span>
              <span className="text-ink-3 text-xs">{STATUS_LABEL[s]}</span>
            </Link>
          );
        })}
      </div>

      {/* Per-platform */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {ALL_PLATFORMS.map((p) => {
          const c = perPlatform[p];
          return (
            <div key={p} className="inline-flex items-center gap-1.5">
              <span
                className="text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: PLATFORM_COLOR[p] }}
              >
                {PLATFORM_LABEL[p]}
              </span>
              <span className="inline-flex items-center gap-0.5">
                {CREATIVE_STATUSES.map((s) => {
                  const active =
                    curPlatforms.length === 1 &&
                    curPlatforms[0] === p &&
                    curStatuses.length === 1 &&
                    curStatuses[0] === s;
                  return (
                    <Link
                      key={s}
                      href={active ? hrefFor([], []) : hrefFor([s], [p])}
                      scroll={false}
                      aria-pressed={active}
                      title={`${PLATFORM_LABEL[p]} · ${STATUS_LABEL[s]}`}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs num transition-colors",
                        active
                          ? "bg-surface-2 text-ink ring-1 ring-line-2"
                          : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                      )}
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: STATUS_DOT[s] }}
                      />
                      {c[s]}
                    </Link>
                  );
                })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
