import Link from "next/link";
import { isoDate, ratio, usd, pct } from "@/lib/format";
import type {
  LaunchCohortRow,
  LaunchReportRow,
} from "@/db/queries/trends";

const monthLabel = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function fmtMonth(ym: string): string {
  // ym is "YYYY-MM"
  const d = new Date(`${ym}-01T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? ym : monthLabel.format(d);
}

/**
 * Launch cohort report. Each creative's first-7 and first-30 day windows
 * are anchored to its own launch_date, so launches from different months
 * are directly comparable. The month cohort strip rolls those up.
 */
export function LaunchReport({
  rows,
  cohorts,
}: {
  rows: LaunchReportRow[];
  cohorts: LaunchCohortRow[];
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-12 text-center">
        <p className="text-ink-2 text-sm">No launched creatives yet.</p>
        <p className="text-ink-3 text-xs mt-1">
          Set a launch date on a creative to see its first-7 / first-30 day
          performance here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Cohort by launch month */}
      {cohorts.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-ink mb-3">By launch month</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {cohorts.map((c) => (
              <div
                key={c.month}
                className="rounded-lg border border-line bg-surface p-3"
              >
                <div className="text-[11px] uppercase tracking-[0.12em] text-ink-3">
                  {fmtMonth(c.month)}
                </div>
                <div className="mt-1.5 flex items-baseline justify-between">
                  <span className="text-ink num text-lg">{usd(c.first30Spend)}</span>
                  <span className="text-[11px] text-ink-3">
                    {c.launches} launch{c.launches === 1 ? "" : "es"}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-ink-2 num">
                  {c.first30Roas === null ? "—" : `${ratio(c.first30Roas)}× ROAS`}
                  <span className="text-ink-3"> · first 30d</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-creative report card */}
      <div>
        <h2 className="text-sm font-medium text-ink mb-3">Per creative</h2>
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm num">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink-3 border-b border-line">
                <th className="font-medium px-3 py-2.5">Creative</th>
                <th className="font-medium px-3 py-2.5">Product</th>
                <th className="font-medium px-3 py-2.5">Launched</th>
                <th
                  className="font-medium px-3 py-2.5 text-right border-l border-line"
                  colSpan={3}
                >
                  First 7 days
                </th>
                <th
                  className="font-medium px-3 py-2.5 text-right border-l border-line"
                  colSpan={3}
                >
                  First 30 days
                </th>
              </tr>
              <tr className="text-left text-[10px] uppercase tracking-[0.12em] text-ink-3 border-b border-line">
                <th colSpan={3}></th>
                <th className="font-medium px-3 py-1.5 text-right border-l border-line">Spend</th>
                <th className="font-medium px-3 py-1.5 text-right">CTR</th>
                <th className="font-medium px-3 py-1.5 text-right">ROAS</th>
                <th className="font-medium px-3 py-1.5 text-right border-l border-line">Spend</th>
                <th className="font-medium px-3 py-1.5 text-right">CTR</th>
                <th className="font-medium px-3 py-1.5 text-right">ROAS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => {
                const partial = r.daysSinceLaunch < 30;
                return (
                  <tr key={r.creativeId} className="hover:bg-surface-2/60 transition-colors">
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/creatives/${encodeURIComponent(r.name)}`}
                        className="font-mono text-ink text-[13px] hover:text-brand transition-colors"
                      >
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-ink-2">{r.productName}</td>
                    <td className="px-3 py-2.5 text-ink-2 whitespace-nowrap">
                      {isoDate(r.launchDate)}
                      <span className="text-ink-3 text-[11px]"> · {r.daysSinceLaunch}d ago</span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-ink tabular-nums border-l border-line">
                      {usd(r.first7.spend)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-ink tabular-nums">{pct(r.first7.ctr)}</td>
                    <td className="px-3 py-2.5 text-right text-ink tabular-nums">
                      {r.first7.roas === null ? "—" : `${ratio(r.first7.roas)}×`}
                    </td>
                    <td className="px-3 py-2.5 text-right text-ink tabular-nums border-l border-line">
                      {usd(r.first30.spend)}
                      {partial && (
                        <span
                          className="ml-1 text-[10px] text-warn"
                          title={`Only ${r.daysSinceLaunch} days elapsed — the 30-day window isn't complete yet.`}
                        >
                          ⧗
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-ink tabular-nums">{pct(r.first30.ctr)}</td>
                    <td className="px-3 py-2.5 text-right text-ink tabular-nums">
                      {r.first30.roas === null ? "—" : `${ratio(r.first30.roas)}×`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-ink-3 mt-2">
          ⧗ marks creatives whose 30-day window hasn&apos;t fully elapsed yet —
          their first-30 figures are still accumulating.
        </p>
      </div>
    </div>
  );
}
