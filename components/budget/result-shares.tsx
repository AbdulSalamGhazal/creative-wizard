"use client";

import { useMemo } from "react";
import { PlatformDot } from "@/components/ui/platform-dot";
import { InfoTip } from "@/components/ui/info-tip";
import { Callout } from "@/components/ui/callout";
import { panelClass } from "@/components/ui/panel";
import { platformLabel } from "@/components/budget/budget-shared";
import { buildResultShares, type RangePlatform } from "@/lib/budget";
import { seriesColor } from "@/lib/palette";
import { pct1 } from "@/lib/format";

/** The purchase-share bar's hue — teal, clear of every platform's identity colour. */
const PURCHASE_COLOR = seriesColor(11);

/**
 * "Where the money works" (2026-11-14, user decision): each platform's share
 * of the range's spend against its share of PLATFORM-REPORTED purchases, so
 * a platform that takes more of the money than it brings back reads at a
 * glance. Figures only: no target and no verdict colour (ahead blue and
 * behind amber mean PACING in Budget, and would mislead here). Every number
 * is `buildResultShares` over the board's own rows — the same days and raw
 * records the board's spend covers.
 */
export function ResultShares({ rows }: { rows: readonly RangePlatform[] }) {
  const shares = useMemo(() => buildResultShares(rows), [rows]);
  if (shares.length === 0) return null; // nothing spent — the board says so

  const reporting = shares.filter((s) => s.spendShare !== null);
  // One scale for both bars: the biggest share in the set fills the track.
  const max = Math.max(
    0.0001,
    ...reporting.flatMap((s) => [s.spendShare ?? 0, s.purchaseShare ?? 0]),
  );
  const width = (share: number | null) => `${Math.max(0, ((share ?? 0) / max) * 100)}%`;

  return (
    <section className={panelClass({ padding: "none" })} aria-labelledby="result-shares-title">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-2.5">
        <span className="inline-flex items-center gap-1">
          <h2 id="result-shares-title" className="text-sm font-medium text-ink">
            Where the money works
          </h2>
          <InfoTip label="About this comparison">
            Each platform&apos;s share of the spend against its share of the purchases the
            platforms report, over the platforms that report purchases. A platform above
            its spend share brings back more than its cut of the money. Platform-reported,
            over the same days and raw records as the board.
          </InfoTip>
        </span>
        <span className="inline-flex items-center gap-3 text-[11px] text-ink-2" aria-hidden>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-3 rounded-sm bg-ink-3" />
            spend
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-3 rounded-sm" style={{ background: PURCHASE_COLOR }} />
            purchases
          </span>
        </span>
      </header>

      {reporting.length === 0 ? (
        <div className="p-3">
          <Callout tone="info">No platform in this range reports purchases.</Callout>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {shares.map((s) => {
            const name = platformLabel(s.platform);
            const words =
              s.spendShare === null
                ? `${name}: doesn't report purchases`
                : `${name}: ${pct1(s.spendShare)} of spend, ${pct1(s.purchaseShare)} of purchases`;
            const gap =
              s.gapPts === null
                ? "—"
                : `${s.gapPts > 0.05 ? "+" : s.gapPts < -0.05 ? "−" : ""}${Math.abs(s.gapPts).toFixed(1)} pt`;
            return (
              <li
                key={s.platform}
                className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-x-4 gap-y-1.5 px-4 py-2.5 sm:grid-cols-[minmax(7rem,9rem)_minmax(0,1fr)_4.5rem]"
                title={words}
              >
                <span className="sr-only">{words}</span>
                <span
                  aria-hidden
                  className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-ink-2"
                >
                  <PlatformDot platform={s.platform} size="sm" />
                  <span className="truncate">{name}</span>
                </span>
                <span
                  aria-hidden
                  className="text-right tabular-nums text-xs text-ink sm:order-last"
                >
                  {gap}
                </span>
                <div aria-hidden className="col-span-2 sm:col-span-1">
                  {s.spendShare === null ? (
                    <p className="text-[11px] text-ink-2">Doesn&apos;t report purchases</p>
                  ) : (
                    <div className="space-y-1">
                      <ShareBar width={width(s.spendShare)} label={pct1(s.spendShare)} className="bg-ink-3" />
                      <ShareBar
                        width={width(s.purchaseShare)}
                        label={pct1(s.purchaseShare)}
                        color={PURCHASE_COLOR}
                      />
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ShareBar({
  width,
  label,
  color,
  className,
}: {
  width: string;
  label: string;
  color?: string;
  className?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full ${className ?? ""}`}
          style={{ width, ...(color ? { background: color } : {}) }}
        />
      </div>
      <span className="w-10 shrink-0 text-right tabular-nums text-[11px] text-ink-2">{label}</span>
    </div>
  );
}
