import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { CreativeListRow } from "@/db/queries/creatives";
import { isoDate, usd } from "@/lib/format";

const TYPE_LABEL: Record<CreativeListRow["type"], string> = {
  video: "Video",
  image: "Image",
  slides: "Slides",
};

const statusClass: Record<CreativeListRow["status"], string> = {
  active: "border-pos/40 text-pos bg-pos/10",
  draft: "border-line-2 text-ink-2 bg-surface-2",
  paused: "border-warn/40 text-warn bg-warn/10",
  archived: "border-line-2 text-ink-3 bg-surface-2",
};

export function CreativeTable({ rows }: { rows: CreativeListRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-16 text-center">
        <p className="text-ink-2 text-sm">No creatives match these filters.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm num">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink-3 border-b border-line">
            <th className="font-medium px-3 py-2.5">Creative</th>
            <th className="font-medium px-3 py-2.5">Product</th>
            <th className="font-medium px-3 py-2.5">Type</th>
            <th className="font-medium px-3 py-2.5">Status</th>
            <th className="font-medium px-3 py-2.5">Launch date</th>
            <th className="font-medium px-3 py-2.5 text-right">30d spend</th>
            <th className="font-medium px-3 py-2.5">Tags</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr
              key={r.id}
              className="hover:bg-surface-2/60 transition-colors"
            >
              <td className="px-3 py-2.5">
                <Link
                  href={`/creatives/${encodeURIComponent(r.name)}`}
                  className="font-mono text-ink text-[13px] hover:text-brand transition-colors"
                >
                  {r.name}
                </Link>
              </td>
              <td className="px-3 py-2.5 text-ink-2">{r.productName}</td>
              <td className="px-3 py-2.5 text-ink-2">{TYPE_LABEL[r.type]}</td>
              <td className="px-3 py-2.5">
                <Badge variant="outline" className={statusClass[r.status]}>
                  {r.status}
                </Badge>
              </td>
              <td className="px-3 py-2.5 text-ink-2">
                {r.launchDate ? isoDate(r.launchDate) : "—"}
              </td>
              <td className="px-3 py-2.5 text-right text-ink">
                {r.spend30d > 0 ? usd(r.spend30d) : "—"}
              </td>
              <td className="px-3 py-2.5 text-ink-2">
                {r.tags.length === 0 ? (
                  <span className="text-ink-3">—</span>
                ) : (
                  <div className="flex items-center gap-1 flex-wrap">
                    {r.tags.slice(0, 3).map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center h-5 px-1.5 rounded text-[10px] bg-surface-2 border border-line text-ink-2"
                      >
                        {t}
                      </span>
                    ))}
                    {r.tags.length > 3 && (
                      <span className="text-[10px] text-ink-3">
                        +{r.tags.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
