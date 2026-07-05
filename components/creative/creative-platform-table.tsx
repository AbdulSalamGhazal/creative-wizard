"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { PLATFORM_LABEL } from "@/lib/palette";
import { PlatformDot } from "@/components/ui/platform-dot";
import { int, pct, roas, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PlatformMixRow, CampaignMixRow } from "@/db/queries/performance";

interface Props {
  rows: PlatformMixRow[];
  /** Per-(platform, campaign) breakdown; grouped by platform in the component. */
  campaigns: CampaignMixRow[];
}

/**
 * This creative's metrics by platform. Each platform row has a chevron that
 * expands a per-campaign breakdown for that platform (collapsed by default) —
 * the same interaction as the Funnel page's platform comparison.
 */
export function CreativePlatformTable({ rows, campaigns }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const campaignsByPlatform = useMemo(() => {
    const m = new Map<string, CampaignMixRow[]>();
    for (const c of campaigns) {
      const list = m.get(c.platform) ?? [];
      list.push(c);
      m.set(c.platform, list);
    }
    return m;
  }, [campaigns]);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center text-ink-3 text-sm">
        No platform activity for this creative.
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
            <th className="font-medium px-3 py-2.5 text-right">Revenue</th>
            <th className="font-medium px-3 py-2.5 text-right">CPA</th>
            <th className="font-medium px-3 py-2.5 text-right">ROAS</th>
            <th className="font-medium px-3 py-2.5 text-right">CPM</th>
            <th className="font-medium px-3 py-2.5 text-right">CTR</th>
            <th className="font-medium px-3 py-2.5 text-right">VOC</th>
            <th className="font-medium px-3 py-2.5 text-right">CvR</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => {
            const isOpen = expanded.has(r.platform);
            const camps = campaignsByPlatform.get(r.platform) ?? [];
            return (
              <Fragment key={r.platform}>
                <tr className="hover:bg-surface-2/60 transition-colors">
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggle(r.platform)}
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? "Collapse" : "Expand"} ${PLATFORM_LABEL[r.platform]} campaigns`}
                      className="inline-flex items-center gap-2 text-ink hover:text-brand transition-colors"
                    >
                      <ChevronRight
                        className={cn(
                          "w-3.5 h-3.5 text-ink-3 transition-transform",
                          isOpen && "rotate-90",
                        )}
                      />
                      <PlatformDot platform={r.platform} />
                      <span className="whitespace-nowrap">{PLATFORM_LABEL[r.platform]}</span>
                      <span className="text-[10px] text-ink-3">
                        {camps.length} campaign{camps.length === 1 ? "" : "s"}
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-right text-ink tabular-nums">{usd(r.spend)}</td>
                  <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{int(r.conversions)}</td>
                  <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{usd(r.conversionValue)}</td>
                  <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{usd(r.cpa)}</td>
                  <td className="px-3 py-2.5 text-right text-ink tabular-nums">{roas(r.roas)}</td>
                  <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{usd(r.cpm)}</td>
                  <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{pct(r.ctr)}</td>
                  <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{pct(r.voc)}</td>
                  <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{pct(r.cvr)}</td>
                </tr>

                {/* Per-campaign breakdown for this platform (collapsed by default) */}
                {isOpen &&
                  camps.map((c) => (
                    <tr
                      key={`${r.platform}::${c.campaign}`}
                      className="bg-surface-2/25 text-[12px]"
                    >
                      <td className="py-1.5 pl-10 pr-3">
                        <span
                          className="block max-w-[24rem] truncate text-ink-2"
                          title={c.campaign}
                        >
                          {c.campaign}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right text-ink-2 tabular-nums">{usd(c.spend)}</td>
                      <td className="px-3 py-1.5 text-right text-ink-3 tabular-nums">{int(c.conversions)}</td>
                      <td className="px-3 py-1.5 text-right text-ink-3 tabular-nums">{usd(c.conversionValue)}</td>
                      <td className="px-3 py-1.5 text-right text-ink-3 tabular-nums">{usd(c.cpa)}</td>
                      <td className="px-3 py-1.5 text-right text-ink-2 tabular-nums">{roas(c.roas)}</td>
                      <td className="px-3 py-1.5 text-right text-ink-3 tabular-nums">{usd(c.cpm)}</td>
                      <td className="px-3 py-1.5 text-right text-ink-3 tabular-nums">{pct(c.ctr)}</td>
                      <td className="px-3 py-1.5 text-right text-ink-3 tabular-nums">{pct(c.voc)}</td>
                      <td className="px-3 py-1.5 text-right text-ink-3 tabular-nums">{pct(c.cvr)}</td>
                    </tr>
                  ))}
                {isOpen && camps.length === 0 && (
                  <tr className="bg-surface-2/25">
                    <td colSpan={10} className="py-2 pl-10 pr-3 text-[11px] text-ink-3">
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
