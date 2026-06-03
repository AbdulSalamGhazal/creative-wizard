import Link from "next/link";
import { Trophy } from "lucide-react";
import { int, ratio, usd } from "@/lib/format";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import type { CampaignPlatformGrainRow } from "@/db/queries/campaign";

/**
 * "Winners within platform" — for each platform, the campaigns with the
 * strongest ROAS (a real performer requires conversions; otherwise we fall
 * back to the biggest spenders). Top 3 per platform, each linking to its page.
 */
export function CampaignWinners({ rows }: { rows: CampaignPlatformGrainRow[] }) {
  if (rows.length === 0) return null;

  const byPlatform = new Map<
    string,
    { rows: CampaignPlatformGrainRow[]; spend: number }
  >();
  for (const r of rows) {
    const e = byPlatform.get(r.platform) ?? { rows: [], spend: 0 };
    e.rows.push(r);
    e.spend += r.spend;
    byPlatform.set(r.platform, e);
  }

  const platforms = [...byPlatform.entries()].sort(
    (a, b) => b[1].spend - a[1].spend,
  );

  const rankColors = ["text-warn", "text-ink-2", "text-ink-3"];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {platforms.map(([platform, { rows: list, spend }]) => {
        const withRoas = list
          .filter((r) => r.roas !== null && r.conversions > 0)
          .sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0));
        const fallback = [...list].sort((a, b) => b.spend - a.spend);
        const top = (withRoas.length > 0 ? withRoas : fallback).slice(0, 3);
        const basis = withRoas.length > 0 ? "ROAS" : "spend";
        return (
          <div
            key={platform}
            className="rounded-lg border border-line bg-surface p-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 text-sm text-ink">
                <span
                  className="w-2.5 h-2.5 rounded-sm"
                  style={{ background: PLATFORM_COLOR[platform as keyof typeof PLATFORM_COLOR] }}
                />
                {PLATFORM_LABEL[platform as keyof typeof PLATFORM_LABEL]}
              </span>
              <span className="text-[10px] text-ink-3 num">
                {list.length} campaign{list.length === 1 ? "" : "s"} · {usd(spend)}
              </span>
            </div>
            <div className="space-y-2">
              {top.map((r, i) => (
                <Link
                  key={r.campaign}
                  href={`/campaigns/${encodeURIComponent(r.campaign)}`}
                  className="flex items-center gap-2.5 group"
                  title={r.campaign}
                >
                  <span className={`shrink-0 ${rankColors[i] ?? "text-ink-3"}`}>
                    {i === 0 ? (
                      <Trophy className="w-3.5 h-3.5" />
                    ) : (
                      <span className="inline-block w-3.5 text-center text-[11px] tabular-nums">
                        {i + 1}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink-2 group-hover:text-brand transition-colors">
                      {r.campaign}
                    </span>
                  </span>
                  <span className="shrink-0 text-right tabular-nums">
                    <span className="block text-[13px] text-ink">
                      {r.roas === null ? "—" : `${ratio(r.roas)}×`}
                    </span>
                    <span className="block text-[10px] text-ink-3">
                      {usd(r.spend)} · {int(r.conversions)} conv
                    </span>
                  </span>
                </Link>
              ))}
            </div>
            <div className="text-[10px] text-ink-3 pt-1 border-t border-line">
              Ranked by {basis}
            </div>
          </div>
        );
      })}
    </div>
  );
}
