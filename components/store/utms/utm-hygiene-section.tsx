"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { InfoTip } from "@/components/ui/info-tip";
import { SourceAssignmentSelect } from "@/components/store/source-assignment-select";
import { int, pct1 } from "@/lib/format";
import { cn } from "@/lib/utils";
import { UNMAPPED_SOURCE } from "@/store/sources";
import {
  share,
  sourceVariants,
  utmBucketColor,
  utmBucketLabel,
  type UtmSourceRow,
} from "@/lib/store-utms";

/**
 * What to fix: values nobody has mapped (an attribution gap, assignable inline
 * by anyone with `config.store`) and values that differ only in case, spacing
 * or punctuation (a tagging gap that splits one source into several rows).
 * Both lists are bounded by the range, so they name what is actually in the
 * numbers above.
 */
export function UtmHygieneSection({
  breakdown,
  totalOrders,
  canConfig,
}: {
  breakdown: UtmSourceRow[];
  totalOrders: number;
  canConfig: boolean;
}) {
  const unmapped = useMemo(
    () =>
      breakdown
        .filter((r): r is UtmSourceRow & { value: string } => r.bucket === UNMAPPED_SOURCE && r.value !== null)
        .sort((a, b) => b.orders - a.orders),
    [breakdown],
  );
  const variants = useMemo(
    () =>
      sourceVariants(
        breakdown
          .filter((r): r is UtmSourceRow & { value: string } => r.value !== null)
          .map((r) => ({ value: r.value, orders: r.orders, bucket: r.bucket })),
      ),
    [breakdown],
  );

  return (
    <section id="hygiene" className="grid gap-3 md:grid-cols-2">
      <div className="min-w-0 rounded-lg border border-line bg-surface p-4">
        <div className="mb-3 flex min-w-0 items-center gap-2">
          <h3 className="shrink-0 text-sm font-medium text-ink">Unmapped values</h3>
          <InfoTip label="About unmapped values">
            A source value with no mapping counts as Unknown everywhere. Map it to its
            platform, or to “Not an ad platform” for direct, messaging and other
            non-ad traffic. Several values may point to one platform.
          </InfoTip>
          {unmapped.length > 0 && (
            <span className="ml-auto min-w-0 truncate text-xs text-ink-3">
              {canConfig ? (
                <Link href="/store/uploads?tab=fields" className="underline hover:text-ink">
                  All mappings
                </Link>
              ) : (
                "Ask an admin to map them in Order fields"
              )}
            </span>
          )}
        </div>
        {unmapped.length === 0 ? (
          <p className="flex items-center gap-1.5 text-xs text-ink-3">
            <Check className="h-3.5 w-3.5" aria-hidden />
            Every source value in range is mapped.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line">
            {unmapped.map((r) => (
              // The row WRAPS: the value is the one cell that must read, so on a
              // phone the select drops to its own line instead of squeezing it.
              <li key={r.value} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
                <span
                  className="min-w-[8rem] flex-1 truncate font-mono text-xs text-ink"
                  title={r.value}
                >
                  {r.value}
                </span>
                <span className="num tabular-nums shrink-0 text-xs text-ink-2">{int(r.orders)}</span>
                <span className="num tabular-nums w-12 shrink-0 text-right text-[11px] text-ink-3">
                  {pct1(share(r.orders, totalOrders))}
                </span>
                {canConfig && (
                  <SourceAssignmentSelect
                    rawValue={r.value}
                    current="unset"
                    size="sm"
                    className="ml-auto"
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="min-w-0 rounded-lg border border-line bg-surface p-4">
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-sm font-medium text-ink">Spelling variants</h3>
          <InfoTip label="About spelling variants">
            Values that differ only in case, spacing or punctuation split one source
            into several rows. Map each to the same platform, or fix the links so one
            spelling remains.
          </InfoTip>
        </div>
        {variants.length === 0 ? (
          <p className="flex items-center gap-1.5 text-xs text-ink-3">
            <Check className="h-3.5 w-3.5" aria-hidden />
            No near-duplicate values in range.
          </p>
        ) : (
          <ul className="space-y-2">
            {variants.map((g) => (
              <li key={g.key} className="flex flex-wrap items-center gap-1.5">
                {g.members.map((m) => (
                  <span
                    key={m.value}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-line px-2 py-0.5 text-xs"
                    title={`${m.value} · ${utmBucketLabel(m.bucket)}`}
                  >
                    <span
                      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: utmBucketColor(m.bucket) }}
                      aria-hidden
                    />
                    <span className="truncate font-mono text-ink">{m.value}</span>
                    <span className="num tabular-nums text-ink-3">{int(m.orders)}</span>
                  </span>
                ))}
                <span className={cn("ml-auto text-[11px]", g.sameBucket ? "sr-only" : "text-warn")}>
                  {g.sameBucket ? "Mapped alike" : "Mapped differently"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
