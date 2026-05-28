"use client";

import { useCallback, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, Plus, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { DateRangePicker } from "@/components/filters/date-range-picker";
import { COMPARE_COLORS } from "@/components/charts/compare-chart";
import { MAX_COMPARE_CREATIVES } from "@/validators/compare";
import { cn } from "@/lib/utils";

interface CreativeOption {
  id: string;
  name: string;
  productName: string;
}

interface Props {
  allCreatives: CreativeOption[];
  selected: string[];
  from: string | null;
  to: string | null;
}

/**
 * Compare toolbar: a searchable creative picker (type to filter by name or
 * product, click to add/remove, up to 5) with color-coded removable chips,
 * plus a date-range filter. All state lives in the URL.
 */
export function CompareControls({ allCreatives, selected, from, to }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [pickerOpen, setPickerOpen] = useState(false);

  const update = useCallback(
    (mutate: (n: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams.toString());
      mutate(next);
      for (const [k, v] of [...next.entries()]) {
        if (!v) next.delete(k);
      }
      const qs = next.toString();
      startTransition(() =>
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }),
      );
    },
    [pathname, router, searchParams],
  );

  const toggleCreative = (id: string) => {
    const set = new Set(selected);
    if (set.has(id)) set.delete(id);
    else if (set.size < MAX_COMPARE_CREATIVES) set.add(id);
    else return;
    update((n) => {
      if (set.size === 0) n.delete("creativeIds");
      else n.set("creativeIds", [...set].join(","));
    });
  };

  const setRange = (f: string | null, t: string | null) => {
    update((n) => {
      if (f && t) {
        n.set("from", f);
        n.set("to", t);
      } else {
        n.delete("from");
        n.delete("to");
      }
    });
  };

  const atMax = selected.length >= MAX_COMPARE_CREATIVES;
  const byId = new Map(allCreatives.map((c) => [c.id, c]));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Searchable creative picker */}
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-2 h-8 px-3 rounded-md border border-brand/50 bg-[var(--brand-soft)] text-xs text-ink hover:bg-brand/15 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add creative
              <span className="text-ink-3">
                {selected.length}/{MAX_COMPARE_CREATIVES}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="p-0 w-80">
            <Command
              filter={(value, search) =>
                value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
              }
            >
              <CommandInput placeholder="Search by name or product…" />
              <CommandList className="max-h-72">
                <CommandEmpty>No creatives found.</CommandEmpty>
                {allCreatives.map((c) => {
                  const idx = selected.indexOf(c.id);
                  const checked = idx >= 0;
                  const disabled = atMax && !checked;
                  return (
                    <CommandItem
                      key={c.id}
                      value={`${c.name} ${c.productName}`}
                      disabled={disabled}
                      onSelect={() => toggleCreative(c.id)}
                      className={cn(disabled && "opacity-40")}
                    >
                      <Check
                        className={cn(
                          "w-3.5 h-3.5 shrink-0 text-brand",
                          checked ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="font-mono text-[12px] truncate">
                        {c.name}
                      </span>
                      <span className="ml-auto text-[11px] text-ink-3 truncate">
                        {c.productName}
                      </span>
                      {checked && (
                        <span
                          className="w-2 h-2 rounded-sm shrink-0"
                          style={{
                            background: COMPARE_COLORS[idx % COMPARE_COLORS.length],
                          }}
                        />
                      )}
                    </CommandItem>
                  );
                })}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* Date range */}
        <DateRangePicker from={from} to={to} onChange={setRange} />

        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => update((n) => n.delete("creativeIds"))}
            className="inline-flex items-center gap-1 h-8 px-3 rounded-md border border-line text-xs text-ink-3 hover:text-ink hover:bg-surface-2 transition-colors"
          >
            <X className="w-3 h-3" />
            Clear creatives
          </button>
        )}
      </div>

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {selected.map((id, i) => {
            const c = byId.get(id);
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
                <span className="text-ink-3 text-[11px]">{c.productName}</span>
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
        </div>
      )}
    </div>
  );
}
