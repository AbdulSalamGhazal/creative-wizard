"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useTransition } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CompareMetric } from "@/db/queries/performance";
import { COMPARE_COLORS } from "@/components/charts/compare-chart";
import { cn } from "@/lib/utils";

const METRICS: Array<{ value: CompareMetric; label: string }> = [
  { value: "spend", label: "Spend" },
  { value: "impressions", label: "Impressions" },
  { value: "clicks", label: "Clicks" },
  { value: "conversions", label: "Conversions" },
  { value: "ctr", label: "CTR" },
  { value: "cpm", label: "CPM" },
  { value: "cpc", label: "CPC" },
  { value: "cpa", label: "CPA" },
  { value: "roas", label: "ROAS" },
  { value: "hookRate", label: "Hook rate" },
];

const MAX_PICKS = 5;

interface Props {
  allCreatives: Array<{ id: string; name: string }>;
  selected: string[];
  metric: CompareMetric;
}

export function CompareControls({ allCreatives, selected, metric }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const update = useCallback(
    (mutate: (n: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams.toString());
      mutate(next);
      for (const [k, v] of [...next.entries()]) {
        if (!v) next.delete(k);
      }
      const qs = next.toString();
      const href = qs ? `${pathname}?${qs}` : pathname;
      startTransition(() => router.replace(href, { scroll: false }));
    },
    [pathname, router, searchParams],
  );

  const toggleCreative = (id: string) => {
    const set = new Set(selected);
    if (set.has(id)) set.delete(id);
    else if (set.size < MAX_PICKS) set.add(id);
    update((n) => {
      if (set.size === 0) n.delete("creativeIds");
      else n.set("creativeIds", [...set].join(","));
    });
  };

  const setMetric = (m: CompareMetric) =>
    update((n) => {
      if (m === "spend") n.delete("metric");
      else n.set("metric", m);
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Creative picker */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-2 h-8 px-3 rounded-md border border-line bg-surface text-xs text-ink-2 hover:text-ink hover:bg-surface-2 transition-colors"
          >
            <span className="text-ink-3">Creatives</span>
            <span className="text-ink">
              {selected.length === 0
                ? "Pick up to 5"
                : `${selected.length}/5 selected`}
            </span>
            <ChevronDown className="w-3 h-3 text-ink-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 max-h-72 overflow-y-auto">
          <DropdownMenuLabel>Pick up to 5 creatives</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {allCreatives.length === 0 && (
            <div className="px-2 py-2 text-xs text-ink-3">
              No creatives in library yet.
            </div>
          )}
          {allCreatives.map((c) => {
            const idx = selected.indexOf(c.id);
            const checked = idx >= 0;
            const disabled = !checked && selected.length >= MAX_PICKS;
            return (
              <DropdownMenuCheckboxItem
                key={c.id}
                checked={checked}
                disabled={disabled}
                onCheckedChange={() => toggleCreative(c.id)}
              >
                <span className="flex-1 truncate">{c.name}</span>
                {checked && (
                  <span
                    className="w-2 h-2 rounded-sm shrink-0"
                    style={{ background: COMPARE_COLORS[idx % COMPARE_COLORS.length] }}
                  />
                )}
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Selected chips */}
      {selected.map((id, i) => {
        const c = allCreatives.find((x) => x.id === id);
        if (!c) return null;
        return (
          <span
            key={id}
            className="inline-flex items-center gap-1.5 h-8 pl-2.5 pr-1.5 rounded-md border border-line bg-surface text-xs text-ink"
          >
            <span
              className="w-2 h-2 rounded-sm shrink-0"
              style={{ background: COMPARE_COLORS[i % COMPARE_COLORS.length] }}
            />
            <span className="font-mono text-[12px]">{c.name}</span>
            <button
              type="button"
              onClick={() => toggleCreative(id)}
              className="ml-1 w-5 h-5 rounded inline-flex items-center justify-center text-ink-3 hover:bg-surface-2 hover:text-ink"
              aria-label={`Remove ${c.name}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        );
      })}

      {/* Metric */}
      <div className="ml-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex items-center gap-2 h-8 px-3 rounded-md border border-line bg-surface text-xs text-ink-2 hover:text-ink hover:bg-surface-2 transition-colors",
              )}
            >
              <span className="text-ink-3">Metric</span>
              <span className="text-ink">
                {METRICS.find((m) => m.value === metric)?.label ?? "Spend"}
              </span>
              <ChevronDown className="w-3 h-3 text-ink-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {METRICS.map((m) => (
              <DropdownMenuItem key={m.value} onSelect={() => setMetric(m.value)}>
                <span className="flex-1">{m.label}</span>
                {metric === m.value && <Check className="w-3.5 h-3.5 text-brand" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
