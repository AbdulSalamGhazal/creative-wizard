"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { PlatformDot } from "@/components/ui/platform-dot";
import { int, pct, ratio, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  PlatformFunnelRow,
  PlatformCampaignRow,
} from "@/db/queries/funnel";

type RateKey =
  | "cpm"
  | "ctr"
  | "voc"
  | "atcRate"
  | "apRate"
  | "purchaseRate"
  | "cvr";

const RATES: Array<{
  key: RateKey;
  label: string;
  fmt: (v: number | null) => string;
  /** CPM is a cost — the leader is the LOWEST, the rest are the highest. */
  lowerBetter: boolean;
  hint: string;
}> = [
  { key: "cpm", label: "CPM", fmt: (v) => usd(v), lowerBetter: true, hint: "cost / 1k impressions" },
  { key: "ctr", label: "CTR", fmt: (v) => pct(v), lowerBetter: false, hint: "clicks / impressions" },
  { key: "voc", label: "VOC", fmt: (v) => pct(v), lowerBetter: false, hint: "LP views / clicks" },
  { key: "atcRate", label: "ATC%", fmt: (v) => pct(v), lowerBetter: false, hint: "add-to-cart / LP views" },
  { key: "apRate", label: "AP%", fmt: (v) => pct(v), lowerBetter: false, hint: "add-payment / add-to-cart" },
  { key: "purchaseRate", label: "CvR (AP)", fmt: (v) => pct(v), lowerBetter: false, hint: "conversions / add-payment" },
  { key: "cvr", label: "CvR (LP)", fmt: (v) => pct(v), lowerBetter: false, hint: "conversions / LP views" },
];

/**
 * Platforms side-by-side across the funnel. Each platform row has a toggle
 * (chevron) before its name that expands a per-campaign breakdown for that
 * platform; collapsed by default. Volumes (spend → impressions → clicks → LP
 * views → conversions) are plain numbers; the four funnel rates get a
 * magnitude bar (scaled to the strongest platform) plus a leader highlight
 * (green = best — lowest CPM, highest CTR/VOC/CvR).
 */
export function PlatformFunnelComparison({
  platforms,
  campaigns,
}: {
  platforms: PlatformFunnelRow[];
  campaigns: PlatformCampaignRow[];
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const campaignsByPlatform = useMemo(() => {
    const m = new Map<string, PlatformCampaignRow[]>();
    for (const c of campaigns) {
      const list = m.get(c.platform) ?? [];
      list.push(c);
      m.set(c.platform, list);
    }
    return m;
  }, [campaigns]);

  // Per rate: which platform leads, and the max magnitude (for bar scaling).
  const { best, maxAbs } = useMemo(() => {
    const best: Partial<Record<RateKey, string>> = {};
    const maxAbs: Record<RateKey, number> = {
      cpm: 0,
      ctr: 0,
      voc: 0,
      atcRate: 0,
      apRate: 0,
      purchaseRate: 0,
      cvr: 0,
    };
    for (const r of RATES) {
      let bestPlat: string | null = null;
      let bestVal: number | null = null;
      let max = 0;
      for (const row of platforms) {
        const v = row[r.key];
        if (v === null) continue;
        if (v > max) max = v;
        if (bestVal === null || (r.lowerBetter ? v < bestVal : v > bestVal)) {
          bestVal = v;
          bestPlat = row.platform;
        }
      }
      if (bestPlat) best[r.key] = bestPlat;
      maxAbs[r.key] = max;
    }
    return { best, maxAbs };
  }, [platforms]);

  if (platforms.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-12 text-center">
        <p className="text-ink-2 text-sm">No platform activity in this window.</p>
      </div>
    );
  }

  const toggle = (platform: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm num">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink-3 border-b border-line">
            <th className="font-medium px-3 py-2.5">Platform</th>
            <th className="font-medium px-3 py-2.5 text-right">Spend</th>
            <th className="font-medium px-3 py-2.5 text-right">Conv.</th>
            <th className="font-medium px-3 py-2.5 text-right">CPA</th>
            <th className="font-medium px-3 py-2.5 text-right">ROAS</th>
            {RATES.map((r) => (
              <th
                key={r.key}
                className="font-medium px-3 py-2.5 text-right whitespace-nowrap"
                title={r.hint}
              >
                {r.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {platforms.map((row) => {
            const isOpen = expanded.has(row.platform);
            const camps = campaignsByPlatform.get(row.platform) ?? [];
            return (
              <Fragment key={row.platform}>
                <tr className="hover:bg-surface-2/40 transition-colors">
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggle(row.platform)}
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? "Collapse" : "Expand"} ${PLATFORM_LABEL[row.platform]} campaigns`}
                      className="inline-flex items-center gap-2 text-ink hover:text-brand transition-colors"
                    >
                      <ChevronRight
                        className={cn(
                          "w-3.5 h-3.5 text-ink-3 transition-transform",
                          isOpen && "rotate-90",
                        )}
                      />
                      <PlatformDot platform={row.platform} />
                      <span className="whitespace-nowrap">
                        {PLATFORM_LABEL[row.platform]}
                      </span>
                      <span className="text-[10px] text-ink-3">
                        {camps.length} campaign{camps.length === 1 ? "" : "s"}
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-right text-ink tabular-nums">{usd(row.spend)}</td>
                  <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{int(row.conversions)}</td>
                  <td className="px-3 py-2.5 text-right text-ink tabular-nums">{usd(row.cpa)}</td>
                  <td className="px-3 py-2.5 text-right text-ink tabular-nums">
                    {row.roas === null ? "—" : `${ratio(row.roas)}×`}
                  </td>
                  {RATES.map((r) => {
                    const v = row[r.key];
                    const isBest = best[r.key] === row.platform;
                    const widthPct =
                      v !== null && maxAbs[r.key] > 0
                        ? Math.max((v / maxAbs[r.key]) * 100, 4)
                        : 0;
                    return (
                      <td key={r.key} className="px-3 py-2 align-middle">
                        <div className="flex flex-col items-end gap-1">
                          <span
                            className={cn(
                              "tabular-nums",
                              isBest ? "text-pos font-semibold" : "text-ink",
                            )}
                            title={isBest ? `Best ${r.label} across platforms` : undefined}
                          >
                            {r.fmt(v)}
                          </span>
                          <span className="block h-1 w-14 rounded bg-surface-2 overflow-hidden">
                            <span
                              className="block h-full rounded"
                              style={{
                                width: `${widthPct}%`,
                                background: PLATFORM_COLOR[row.platform],
                                opacity: isBest ? 1 : 0.5,
                              }}
                            />
                          </span>
                        </div>
                      </td>
                    );
                  })}
                </tr>

                {/* Per-campaign breakdown (collapsed by default) */}
                {isOpen &&
                  camps.map((c) => (
                    <tr
                      key={`${row.platform}::${c.campaign}`}
                      className="bg-surface-2/25 text-xs"
                    >
                      <td className="py-1.5 pl-10 pr-3">
                        <span
                          className="block max-w-[22rem] truncate text-ink-2"
                          title={c.campaign}
                        >
                          {c.campaign}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right text-ink-2 tabular-nums">{usd(c.spend)}</td>
                      <td className="px-3 py-1.5 text-right text-ink-3 tabular-nums">{int(c.conversions)}</td>
                      <td className="px-3 py-1.5 text-right text-ink-2 tabular-nums">{usd(c.cpa)}</td>
                      <td className="px-3 py-1.5 text-right text-ink-2 tabular-nums">
                        {c.roas === null ? "—" : `${ratio(c.roas)}×`}
                      </td>
                      <td className="px-3 py-1.5 text-right text-ink-2 tabular-nums">{usd(c.cpm)}</td>
                      <td className="px-3 py-1.5 text-right text-ink-2 tabular-nums">{pct(c.ctr)}</td>
                      <td className="px-3 py-1.5 text-right text-ink-2 tabular-nums">{pct(c.voc)}</td>
                      <td className="px-3 py-1.5 text-right text-ink-2 tabular-nums">{pct(c.atcRate)}</td>
                      <td className="px-3 py-1.5 text-right text-ink-2 tabular-nums">{pct(c.apRate)}</td>
                      <td className="px-3 py-1.5 text-right text-ink-2 tabular-nums">{pct(c.purchaseRate)}</td>
                      <td className="px-3 py-1.5 text-right text-ink-2 tabular-nums">{pct(c.cvr)}</td>
                    </tr>
                  ))}
                {isOpen && camps.length === 0 && (
                  <tr className="bg-surface-2/25">
                    <td colSpan={12} className="py-2 pl-10 pr-3 text-[11px] text-ink-3">
                      No campaigns in this window.
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
