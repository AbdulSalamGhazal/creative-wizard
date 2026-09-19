"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  CREATIVE_STATUSES,
  STATUS_DOT,
  STATUS_LABEL,
  type CreativeStatusBreakdown,
} from "@/lib/creative-status";
import { cn } from "@/lib/utils";

const csv = (v: string | null): string[] =>
  v ? v.split(",").filter(Boolean) : [];

/**
 * The Library's status strip: the matching count plus one click-to-toggle chip
 * per status. It sits directly ABOVE the list (table or grid), not in the page
 * header — it describes what you are looking at, so it belongs next to it and
 * has to move when the filters move.
 *
 * The counts are a FACET: they come from the listing's own rows with every
 * filter applied EXCEPT the status filter, so the chips stay toggleable
 * (selecting "Active" doesn't zero the other three) and the strip can never
 * disagree with the rows below it.
 *
 * The per-platform row was REMOVED in 2026-09 (user decision) — the platform
 * filter in the bar does that job, and the grid of 20 counts was noise.
 */
export function CreativeStatusSummary({
  breakdown,
}: {
  breakdown: CreativeStatusBreakdown;
}) {
  const { total, general } = breakdown;
  const pathname = usePathname();
  const sp = useSearchParams();
  const curStatuses = csv(sp.get("statuses"));

  const hrefFor = (statuses: string[]): string => {
    const next = new URLSearchParams(sp.toString());
    if (statuses.length) next.set("statuses", statuses.join(","));
    else next.delete("statuses");
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="num mr-0.5 text-sm text-ink-3">{total} creatives</span>
      {CREATIVE_STATUSES.map((s) => {
        const active = curStatuses.length === 1 && curStatuses[0] === s;
        return (
          <Link
            key={s}
            href={active ? hrefFor([]) : hrefFor([s])}
            scroll={false}
            aria-pressed={active}
            className={cn(
              "num inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm transition-colors",
              active
                ? "border-line-2 bg-surface-2 text-ink"
                : "border-transparent text-ink-2 hover:bg-surface-2 hover:text-ink",
            )}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: STATUS_DOT[s] }}
            />
            <span className="font-semibold text-ink">{general[s]}</span>
            <span className="text-xs text-ink-3">{STATUS_LABEL[s]}</span>
          </Link>
        );
      })}
    </div>
  );
}
