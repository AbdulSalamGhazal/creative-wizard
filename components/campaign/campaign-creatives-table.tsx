import Link from "next/link";
import Image from "next/image";
import { Film, Image as ImageIcon, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { int, pct, ratio, usd } from "@/lib/format";
import { gradientFor } from "@/lib/palette";
import type { CampaignCreativeRow } from "@/db/queries/campaign";

const TYPE_ICON: Record<
  CampaignCreativeRow["type"],
  React.ComponentType<{ className?: string }>
> = { video: Film, image: ImageIcon, slides: Layers };

const TYPE_LABEL: Record<CampaignCreativeRow["type"], string> = {
  video: "Video",
  image: "Image",
  slides: "Slides",
};

const statusBadge: Record<CampaignCreativeRow["status"], string> = {
  active: "border-pos/40 text-pos bg-pos/10",
  draft: "border-line-2 text-ink-2 bg-surface-2",
  paused: "border-warn/40 text-warn bg-warn/10",
  archived: "border-line-2 text-ink-3 bg-surface-2",
};

/**
 * Creatives that ran in this campaign, by spend. Included for context — each
 * links out to its own creative page, where the deeper creative analysis lives.
 */
export function CampaignCreativesTable({ rows }: { rows: CampaignCreativeRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center text-ink-3 text-sm">
        No creatives ran in this window.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm num">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink-3 border-b border-line">
            <th className="font-medium px-3 py-2.5">Creative</th>
            <th className="font-medium px-3 py-2.5">Status</th>
            <th className="font-medium px-3 py-2.5 text-right">Spend</th>
            <th className="font-medium px-3 py-2.5 text-right">Impr.</th>
            <th className="font-medium px-3 py-2.5 text-right">CTR</th>
            <th className="font-medium px-3 py-2.5 text-right">Conv.</th>
            <th className="font-medium px-3 py-2.5 text-right">CvR</th>
            <th className="font-medium px-3 py-2.5 text-right">ROAS</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => {
            const TypeIcon = TYPE_ICON[r.type];
            const grad = gradientFor(r.name);
            return (
              <tr key={r.creativeId} className="hover:bg-surface-2/50 transition-colors">
                <td className="px-3 py-2.5">
                  <Link
                    href={`/creatives/${encodeURIComponent(r.name)}`}
                    className="inline-flex items-center gap-2.5 min-w-0 group"
                    title={r.name}
                  >
                    <span className="relative w-9 h-9 rounded-md overflow-hidden border border-line shrink-0 bg-surface-2">
                      {r.thumbnailUrl ? (
                        <Image
                          src={r.thumbnailUrl}
                          alt=""
                          fill
                          sizes="36px"
                          className="object-cover"
                        />
                      ) : (
                        <span
                          className="absolute inset-0 flex items-center justify-center"
                          style={{ background: `linear-gradient(135deg, ${grad.from}, ${grad.to})` }}
                        >
                          <TypeIcon className="w-4 h-4 text-white/80" />
                        </span>
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate max-w-[18rem] font-mono text-[13px] text-ink group-hover:text-brand transition-colors">
                        {r.name}
                      </span>
                      <span className="block text-[10px] text-ink-3 uppercase tracking-wide">
                        {TYPE_LABEL[r.type]}
                      </span>
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-2.5">
                  <Badge variant="outline" className={`text-[10px] ${statusBadge[r.status]}`}>
                    {r.status}
                  </Badge>
                </td>
                <td className="px-3 py-2.5 text-right text-ink tabular-nums">{usd(r.spend)}</td>
                <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{int(r.impressions)}</td>
                <td className="px-3 py-2.5 text-right text-ink tabular-nums">{pct(r.ctr)}</td>
                <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{int(r.conversions)}</td>
                <td className="px-3 py-2.5 text-right text-ink tabular-nums">{pct(r.cvr)}</td>
                <td className="px-3 py-2.5 text-right text-ink tabular-nums">
                  {r.roas === null ? "—" : `${ratio(r.roas)}×`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
