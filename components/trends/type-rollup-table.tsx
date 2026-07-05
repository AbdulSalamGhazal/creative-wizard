import { Fragment } from "react";
import Link from "next/link";
import { int, pct, ratio, usd } from "@/lib/format";
import {
  ALL_PLATFORMS,
  PLATFORM_LABEL,
  TYPE_COLOR,
  TYPE_LABEL,
} from "@/lib/palette";
import { PlatformDot } from "@/components/ui/platform-dot";
import type { TypeRollupRow } from "@/db/queries/trends";

type Platform = (typeof ALL_PLATFORMS)[number];
const TYPE_ORDER: Array<TypeRollupRow["type"]> = ["video", "image", "slides"];

/** Numeric cells shared by both layouts. */
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
      <td className="px-3 py-2.5 text-right text-ink tabular-nums">{pct(r.cvr)}</td>
    </>
  );
}

/**
 * Performance by creative type. Blended mode = one row per type. With
 * `byPlatform`, the table is grouped by PLATFORM (parent) with one type row
 * (child) under each. Rows link into the matching filtered Library view.
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

  // Group by platform for the per-platform layout, preserving the canonical
  // platform order and the canonical type order within each.
  const byPlatformMap = new Map<Platform, TypeRollupRow[]>();
  for (const r of rows) {
    if (!r.platform) continue;
    const list = byPlatformMap.get(r.platform) ?? [];
    list.push(r);
    byPlatformMap.set(r.platform, list);
  }
  const orderedPlatforms = ALL_PLATFORMS.filter((p) => byPlatformMap.has(p));
  for (const p of orderedPlatforms) {
    byPlatformMap
      .get(p)!
      .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm num">
        <thead>
          <tr className="text-left text-label text-ink-3 border-b border-line">
            <th className="font-medium px-3 py-2.5">
              {byPlatform ? "Platform · Type" : "Type"}
            </th>
            <th className="font-medium px-3 py-2.5 text-right">Creatives</th>
            <th className="font-medium px-3 py-2.5 text-right">Spend</th>
            <th className="font-medium px-3 py-2.5 text-right">Impressions</th>
            <th className="font-medium px-3 py-2.5 text-right">CTR</th>
            <th className="font-medium px-3 py-2.5 text-right">CPC</th>
            <th className="font-medium px-3 py-2.5 text-right">CPA</th>
            <th className="font-medium px-3 py-2.5 text-right">ROAS</th>
            <th className="font-medium px-3 py-2.5 text-right">CvR</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {byPlatform
            ? orderedPlatforms.map((platform) => (
                <Fragment key={platform}>
                  <tr className="bg-surface-2/40">
                    <td colSpan={9} className="px-3 py-1.5">
                      <span className="inline-flex items-center gap-2 text-label text-ink-2">
                        <PlatformDot platform={platform} />
                        {PLATFORM_LABEL[platform]}
                      </span>
                    </td>
                  </tr>
                  {byPlatformMap.get(platform)!.map((r) => (
                    <tr
                      key={`${platform}-${r.type}`}
                      className="hover:bg-surface-2/60 transition-colors"
                    >
                      <td className="px-3 py-2.5 pl-6">
                        <Link
                          href={`/creatives?types=${r.type}&platforms=${platform}`}
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
