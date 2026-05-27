import { Badge } from "@/components/ui/badge";
import { int, pct, ratio, usd } from "@/lib/format";
import type { TopCreativeRow } from "@/db/queries/performance";

interface Props {
  rows: TopCreativeRow[];
}

const TYPE_LABEL: Record<TopCreativeRow["type"], string> = {
  video: "Video",
  image: "Image",
  slides: "Slides",
};

const statusClass: Record<TopCreativeRow["status"], string> = {
  active: "border-pos/40 text-pos bg-pos/10",
  draft: "border-line-2 text-ink-2 bg-surface-2",
  paused: "border-warn/40 text-warn bg-warn/10",
  archived: "border-line-2 text-ink-3 bg-surface-2",
};

export function TopCreativesTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-md">
        No creatives in the selected window.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto -mx-2">
      <table className="w-full text-sm num">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink-3">
            <th className="font-medium px-2 py-2 w-8">#</th>
            <th className="font-medium px-2 py-2">Creative</th>
            <th className="font-medium px-2 py-2">Product</th>
            <th className="font-medium px-2 py-2">Type</th>
            <th className="font-medium px-2 py-2">Status</th>
            <th className="font-medium px-2 py-2 text-right">Spend</th>
            <th className="font-medium px-2 py-2 text-right">Impressions</th>
            <th className="font-medium px-2 py-2 text-right">CTR</th>
            <th className="font-medium px-2 py-2 text-right">Conv.</th>
            <th className="font-medium px-2 py-2 text-right">ROAS</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => (
            <tr key={r.creativeId} className="hover:bg-surface-2/60 transition-colors">
              <td className="px-2 py-2.5 text-ink-3">{i + 1}</td>
              <td className="px-2 py-2.5 font-mono text-ink text-[13px]">{r.name}</td>
              <td className="px-2 py-2.5 text-ink-2">{r.productName}</td>
              <td className="px-2 py-2.5 text-ink-2">{TYPE_LABEL[r.type]}</td>
              <td className="px-2 py-2.5">
                <Badge variant="outline" className={statusClass[r.status]}>
                  {r.status}
                </Badge>
              </td>
              <td className="px-2 py-2.5 text-right text-ink">{usd(r.spend)}</td>
              <td className="px-2 py-2.5 text-right text-ink-2">{int(r.impressions)}</td>
              <td className="px-2 py-2.5 text-right text-ink-2">{pct(r.ctr)}</td>
              <td className="px-2 py-2.5 text-right text-ink-2">{int(r.conversions)}</td>
              <td className="px-2 py-2.5 text-right text-ink">{ratio(r.roas)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
