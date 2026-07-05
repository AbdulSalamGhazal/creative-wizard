"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useNavTransition } from "@/lib/nav-progress";
import { Check, ChevronDown, Plus, RotateCcw, X } from "lucide-react";
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
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { cn } from "@/lib/utils";
import type { CompareDimensionRow } from "@/db/queries/performance";
import type { CompareSide, SideKey } from "@/validators/compare";

type Platform = CompareDimensionRow["platform"];

interface Props {
  dimensions: CompareDimensionRow[];
  sides: CompareSide[];
  /** Shared (default) window — applies to sides without their own. */
  from: string | null;
  to: string | null;
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
function toggle(arr: string[], v: string): string[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

export function CompareControls({ dimensions, sides, from, to }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useNavTransition();

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
  const setSideRange = (prefix: SideKey, f: string | null, t: string | null) =>
    update((p) => {
      if (f) p.set(`${prefix}From`, f);
      else p.delete(`${prefix}From`);
      if (t) p.set(`${prefix}To`, t);
      else p.delete(`${prefix}To`);
    });
  const addSideC = () => update((p) => p.set("sides", "3"));
  const removeSideC = () =>
    update((p) => {
      ["sides", "cPlatforms", "cCampaigns", "cCreatives", "cFrom", "cTo"].forEach(
        (k) => p.delete(k),
      );
    });

  const sharedRange = from && to ? { from, to } : undefined;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <DateRangePicker from={from} to={to} onChange={setRange} />
        <span className="text-[11px] text-ink-3">
          Shared window — sides without their own window follow it.
        </span>
      </div>
      <div
        className={cn(
          "grid grid-cols-1 gap-3",
          sides.length >= 3 ? "lg:grid-cols-3" : "lg:grid-cols-2",
        )}
      >
        {sides.map((side, i) => (
          <SideCard
            key={side.key}
            side={side}
            accent={COMPARE_COLORS[i % COMPARE_COLORS.length] ?? "#FF4D8D"}
            dimensions={dimensions}
            sharedRange={sharedRange}
            setParam={setParam}
            setSideRange={setSideRange}
            onRemove={side.key === "c" ? removeSideC : undefined}
          />
        ))}
        {sides.length === 2 && (
          // self-start + justify-self-start keep the button text-sized instead
          // of stretching to the side cards' grid cell.
          <button
            type="button"
            onClick={addSideC}
            className="self-start justify-self-start inline-flex items-center gap-2 h-9 px-4 rounded-lg border border-dashed border-line text-sm text-ink-2 hover:text-ink hover:border-line-2 hover:bg-surface-2/50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add side C
          </button>
        )}
      </div>
    </div>
  );
}

interface Option {
  value: string;
  label: string;
  sub?: string;
  /** Optional colored dot drawn before the label (e.g. the platform color). */
  dot?: string;
}

function SideCard({
  side,
  accent,
  dimensions,
  sharedRange,
  setParam,
  setSideRange,
  onRemove,
}: {
  side: CompareSide;
  accent: string;
  dimensions: CompareDimensionRow[];
  sharedRange: { from: string; to: string } | undefined;
  setParam: (key: string, values: string[]) => void;
  setSideRange: (prefix: SideKey, f: string | null, t: string | null) => void;
  onRemove?: () => void;
}) {
  const prefix = side.key;
  const platformOpts = uniq(dimensions.map((d) => d.platform)) as Platform[];

  // Cascading: campaign options reflect the selected platforms; creative
  // options reflect selected platforms + campaigns. Empty level = "all".
  const campaignPool = dimensions.filter(
    (d) => side.platforms.length === 0 || side.platforms.includes(d.platform),
  );
  const campaignOpts = uniq(campaignPool.map((d) => d.campaign));
  // One campaign name belongs to exactly one platform (E060), so this is 1:1.
  const platformByCampaign = new Map<string, Platform>(
    campaignPool.map((d) => [d.campaign, d.platform]),
  );

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

  const hasOwnWindow = Boolean(side.from && side.to);

  return (
    <div className="rounded-lg border border-line bg-surface p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <span
          className="w-2.5 h-2.5 rounded-sm shrink-0"
          style={{ background: accent }}
        />
        <h3 className="text-sm font-medium text-ink">{side.label}</h3>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="ml-auto text-ink-3 hover:text-neg transition-colors"
            aria-label={`Remove ${side.label}`}
            title={`Remove ${side.label}`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Side-specific window — overrides the shared one for this side only. */}
      <div className="flex items-start gap-2">
        <span className="text-[10px] uppercase tracking-[0.14em] text-ink-3 w-16 shrink-0 pt-2">
          Window
        </span>
        <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
          <DateRangePicker
            from={side.from}
            to={side.to}
            onChange={(f, t) => setSideRange(prefix, f, t)}
            fallback={sharedRange}
          />
          {hasOwnWindow ? (
            <button
              type="button"
              onClick={() => setSideRange(prefix, null, null)}
              className="inline-flex items-center gap-1 h-8 px-2 rounded-md border border-line text-[11px] text-ink-3 hover:text-ink hover:bg-surface-2 transition-colors"
              title="Drop this side's own window and follow the shared one"
            >
              <RotateCcw className="w-3 h-3" />
              Use shared
            </button>
          ) : (
            <span className="text-[10px] text-ink-3">shared</span>
          )}
        </div>
      </div>

      <MultiSelect
        label="Platform"
        options={platformOpts.map((p) => ({
          value: p,
          label: PLATFORM_LABEL[p],
          dot: PLATFORM_COLOR[p],
        }))}
        selected={side.platforms}
        onToggle={(v) => setParam(`${prefix}Platforms`, toggle(side.platforms, v))}
      />
      <MultiSelect
        label="Campaign"
        options={campaignOpts.map((c) => {
          const p = platformByCampaign.get(c);
          return {
            value: c,
            label: c,
            sub: p ? PLATFORM_LABEL[p] : undefined,
            dot: p ? PLATFORM_COLOR[p] : undefined,
          };
        })}
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
  const labelFor = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const dotFor = (v: string) => options.find((o) => o.value === v)?.dot;
  const summary =
    selected.length === 0 ? "All" : selected.map(labelFor).join(", ");
  return (
    <div className="flex items-start gap-2">
      <span className="text-[10px] uppercase tracking-[0.14em] text-ink-3 w-16 shrink-0 pt-2">
        {label}
      </span>
      <div className="flex-1 min-w-0 space-y-1.5">
        <Popover>
          <PopoverTrigger className="w-full min-w-0 flex items-center justify-between gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-xs hover:border-line-2 transition-colors">
            <span
              className={
                "min-w-0 truncate text-left " +
                (selected.length ? "text-ink" : "text-ink-3")
              }
              title={selected.length ? summary : undefined}
            >
              {summary}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-ink-3 shrink-0" />
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[34rem] max-w-[90vw] p-0"
          >
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
                            ? "bg-brand border-brand text-primary-foreground"
                            : "border-line-2")
                        }
                      >
                        {isSel && <Check className="w-3 h-3" />}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-1.5 min-w-0">
                          {o.dot && (
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ background: o.dot }}
                            />
                          )}
                          <span className="truncate">{o.label}</span>
                        </span>
                        {o.sub && (
                          <span className="block truncate text-[10px] text-ink-3 pl-3.5">
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
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {selected.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onToggle(v)}
                title={`Remove ${labelFor(v)}`}
                className="group inline-flex max-w-full items-center gap-1 rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] text-ink-2 hover:border-line-2 hover:text-ink transition-colors"
              >
                {dotFor(v) && (
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: dotFor(v)! }}
                  />
                )}
                <span className="truncate">{labelFor(v)}</span>
                <X className="h-2.5 w-2.5 shrink-0 text-ink-3 group-hover:text-neg" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
