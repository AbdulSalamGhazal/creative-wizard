"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { DateRangePicker } from "@/components/filters/date-range-picker";
import { COMPARE_COLORS } from "@/components/charts/compare-chart";
import { PLATFORM_LABEL } from "@/lib/palette";
import type { CompareDimensionRow } from "@/db/queries/performance";
import type { CompareSide } from "@/validators/compare";

type Platform = CompareDimensionRow["platform"];

interface Props {
  dimensions: CompareDimensionRow[];
  sideA: CompareSide;
  sideB: CompareSide;
  from: string | null;
  to: string | null;
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
function toggle(arr: string[], v: string): string[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

export function CompareControls({ dimensions, sideA, sideB, from, to }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const update = (mut: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(searchParams.toString());
    mut(p);
    const qs = p.toString();
    startTransition(() =>
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }),
    );
  };
  const setParam = (key: string, values: string[]) =>
    update((p) => {
      if (values.length) p.set(key, values.join(","));
      else p.delete(key);
    });
  const setRange = (f: string | null, t: string | null) =>
    update((p) => {
      if (f) p.set("from", f);
      else p.delete("from");
      if (t) p.set("to", t);
      else p.delete("to");
    });

  return (
    <div className="space-y-3">
      <DateRangePicker from={from} to={to} onChange={setRange} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <SideCard
          label="Side A"
          accent={COMPARE_COLORS[0] ?? "#FF4D8D"}
          side={sideA}
          prefix="a"
          dimensions={dimensions}
          setParam={setParam}
        />
        <SideCard
          label="Side B"
          accent={COMPARE_COLORS[1] ?? "#5EE6A8"}
          side={sideB}
          prefix="b"
          dimensions={dimensions}
          setParam={setParam}
        />
      </div>
    </div>
  );
}

interface Option {
  value: string;
  label: string;
  sub?: string;
}

function SideCard({
  label,
  accent,
  side,
  prefix,
  dimensions,
  setParam,
}: {
  label: string;
  accent: string;
  side: CompareSide;
  prefix: "a" | "b";
  dimensions: CompareDimensionRow[];
  setParam: (key: string, values: string[]) => void;
}) {
  const platformOpts = uniq(dimensions.map((d) => d.platform)) as Platform[];

  // Cascading: campaign options reflect the selected platforms; creative
  // options reflect selected platforms + campaigns. Empty level = "all".
  const campaignPool = dimensions.filter(
    (d) => side.platforms.length === 0 || side.platforms.includes(d.platform),
  );
  const campaignOpts = uniq(campaignPool.map((d) => d.campaign));

  const creativePool = campaignPool.filter(
    (d) => side.campaigns.length === 0 || side.campaigns.includes(d.campaign),
  );
  const seen = new Set<string>();
  const creativeOpts: Option[] = [];
  for (const d of creativePool) {
    if (seen.has(d.creativeId)) continue;
    seen.add(d.creativeId);
    creativeOpts.push({
      value: d.creativeId,
      label: d.creativeName,
      sub: d.productName,
    });
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <span
          className="w-2.5 h-2.5 rounded-sm shrink-0"
          style={{ background: accent }}
        />
        <h3 className="text-sm font-medium text-ink">{label}</h3>
      </div>
      <MultiSelect
        label="Platform"
        options={platformOpts.map((p) => ({
          value: p,
          label: PLATFORM_LABEL[p],
        }))}
        selected={side.platforms}
        onToggle={(v) => setParam(`${prefix}Platforms`, toggle(side.platforms, v))}
      />
      <MultiSelect
        label="Campaign"
        options={campaignOpts.map((c) => ({ value: c, label: c }))}
        selected={side.campaigns}
        onToggle={(v) => setParam(`${prefix}Campaigns`, toggle(side.campaigns, v))}
      />
      <MultiSelect
        label="Creative"
        options={creativeOpts}
        selected={side.creatives}
        onToggle={(v) =>
          setParam(`${prefix}Creatives`, toggle(side.creatives, v))
        }
      />
    </div>
  );
}

function MultiSelect({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: Option[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  const summary = selected.length === 0 ? "All" : `${selected.length} selected`;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-[0.14em] text-ink-3 w-16 shrink-0">
        {label}
      </span>
      <Popover>
        <PopoverTrigger className="flex-1 flex items-center justify-between gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-xs hover:border-line-2 transition-colors">
          <span className={selected.length ? "text-ink" : "text-ink-3"}>
            {summary}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-ink-3 shrink-0" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[22rem] p-0">
          <Command>
            <CommandInput placeholder={`Search ${label.toLowerCase()}…`} />
            <CommandList className="max-h-72">
              <CommandEmpty>No matches.</CommandEmpty>
              <CommandGroup>
                {options.map((o) => {
                  const isSel = selected.includes(o.value);
                  return (
                    <CommandItem
                      key={o.value}
                      value={`${o.value} ${o.label} ${o.sub ?? ""}`}
                      onSelect={() => onToggle(o.value)}
                      className="flex items-center gap-2"
                    >
                      <span
                        className={
                          "w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 " +
                          (isSel
                            ? "bg-brand border-brand text-white"
                            : "border-line-2")
                        }
                      >
                        {isSel && <Check className="w-3 h-3" />}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block truncate">{o.label}</span>
                        {o.sub && (
                          <span className="block truncate text-[10px] text-ink-3">
                            {o.sub}
                          </span>
                        )}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
