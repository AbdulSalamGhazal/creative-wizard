import { Fragment } from "react";
import Link from "next/link";
import { int, pct, ratio, usd } from "@/lib/format";
import {
  PLATFORM_COLOR,
  PLATFORM_LABEL,
  TYPE_COLOR,
  TYPE_LABEL,
} from "@/lib/palette";
import type { TypeRollupRow } from "@/db/queries/trends";

const TYPE_ORDER: Array<TypeRollupRow["type"]> = ["video", "image", "slides"];

/** The numeric cells, shared by the blended and per-platform rows. */
function MetricCells({ r }: { r: TypeRollupRow }) {
  return (
    <>
      <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{int(r.creatives)}</td>
      <td className="px-3 py-2.5 text-right text-ink tabular-nums">{usd(r.spend)}</td>
      <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{int(r.impressions)}</td>
      <td className="px-3 py-2.5 text-right text-ink tabular-nums">{pct(r.ctr)}</td>
      <td className="px-3 py-2.5 text-right text-ink tabular-nums">{usd(r.cpc)}</td>
      <td className="px-3 py-2.5 text-right text-ink tabular-nums">{usd(r.cpa)}</td>
      <td className="px-3 py-2.5 text-right text-ink tabular-nums">
        {r.roas === null ? "—" : `${ratio(r.roas)}×`}
      </td>
    </>
  );
}

/**
 * Performance rolled up by creative type. In blended mode one row per type;
 * with `byPlatform`, each type is a group of per-platform rows. Each row links
 * to the matching filtered Library view.
 */
export function TypeRollupTable({
  rows,
  byPlatform,
}: {
  rows: TypeRollupRow[];
  byPlatform: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-12 text-center">
        <p className="text-ink-2 text-sm">No performance in this window.</p>
      </div>
    );
  }

  const byType = new Map<TypeRollupRow["type"], TypeRollupRow[]>();
  for (const r of rows) {
    const list = byType.get(r.type) ?? [];
    list.push(r);
    byType.set(r.type, list);
  }
  const orderedTypes = TYPE_ORDER.filter((t) => byType.has(t));

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm num">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink-3 border-b border-line">
            <th className="font-medium px-3 py-2.5">
              {byPlatform ? "Type · Platform" : "Type"}
            </th>
            <th className="font-medium px-3 py-2.5 text-right">Creatives</th>
            <th className="font-medium px-3 py-2.5 text-right">Spend</th>
            <th className="font-medium px-3 py-2.5 text-right">Impressions</th>
            <th className="font-medium px-3 py-2.5 text-right">CTR</th>
            <th className="font-medium px-3 py-2.5 text-right">CPC</th>
            <th className="font-medium px-3 py-2.5 text-right">CPA</th>
            <th className="font-medium px-3 py-2.5 text-right">ROAS</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {byPlatform
            ? orderedTypes.map((type) => (
                <Fragment key={type}>
                  <tr className="bg-surface-2/40">
                    <td colSpan={8} className="px-3 py-1.5">
                      <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-ink-2">
                        <span
                          className="w-2 h-2 rounded-sm"
                          style={{ background: TYPE_COLOR[type] }}
                        />
                        {TYPE_LABEL[type]}
                      </span>
                    </td>
                  </tr>
                  {byType.get(type)!.map((r) => (
                    <tr
                      key={`${type}-${r.platform ?? "all"}`}
                      className="hover:bg-surface-2/60 transition-colors"
                    >
                      <td className="px-3 py-2.5 pl-6">
                        <Link
                          href={`/creatives?types=${type}${r.platform ? `&platforms=${r.platform}` : ""}`}
                          className="inline-flex items-center gap-1.5 text-ink hover:text-brand transition-colors"
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{
                              background: r.platform
                                ? PLATFORM_COLOR[r.platform]
                                : "var(--ink-3)",
                            }}
                          />
                          {r.platform ? PLATFORM_LABEL[r.platform] : "All"}
                        </Link>
                      </td>
                      <MetricCells r={r} />
                    </tr>
                  ))}
                </Fragment>
              ))
            : rows.map((r) => (
                <tr key={r.type} className="hover:bg-surface-2/60 transition-colors">
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/creatives?types=${r.type}`}
                      className="inline-flex items-center gap-1.5 text-ink hover:text-brand transition-colors"
                    >
                      <span
                        className="w-2 h-2 rounded-sm"
                        style={{ background: TYPE_COLOR[r.type] }}
                      />
                      {TYPE_LABEL[r.type]}
                    </Link>
                  </td>
                  <MetricCells r={r} />
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}
