"use client";

import { Layers, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DateRangePicker } from "@/components/filters/date-range-picker";
import { cn } from "@/lib/utils";

const PLATFORMS = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "tiktok", label: "TikTok" },
  { value: "snapchat", label: "Snapchat" },
  { value: "google", label: "Google" },
] as const;

const COMPARE = [
  { value: "prev", label: "Prev" },
  { value: "wow", label: "WoW" },
  { value: "mom", label: "MoM" },
] as const;

function csv(v: string | null): string[] {
  return v ? v.split(",").filter(Boolean) : [];
}

export function PortfolioFilterBar({
  defaultFrom,
  defaultTo,
}: {
  /** Effective default range (remembered choice) for the picker label. */
  defaultFrom?: string;
  defaultTo?: string;
} = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const compare = searchParams.get("compare") ?? "prev";
  const platforms = useMemo(
    () => csv(searchParams.get("platforms")),
    [searchParams],
  );
  const qParam = searchParams.get("q") ?? "";

  const update = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams.toString());
      mutate(next);
      for (const [key, value] of [...next.entries()]) {
        if (!value) next.delete(key);
      }
      const qs = next.toString();
      const href = qs ? `${pathname}?${qs}` : pathname;
      startTransition(() => router.replace(href, { scroll: false }));
    },
    [pathname, router, searchParams],
  );

  // Debounced campaign search.
  const [qLocal, setQLocal] = useState(qParam);
  useEffect(() => setQLocal(qParam), [qParam]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (qLocal === qParam) return;
      update((next) => {
        if (qLocal.trim()) next.set("q", qLocal.trim());
        else next.delete("q");
      });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qLocal]);

  const setRange = (f: string | null, t: string | null) => {
    update((next) => {
      if (f) next.set("from", f);
      else next.delete("from");
      if (t) next.set("to", t);
      else next.delete("to");
    });
  };

  const setCompare = (mode: string) => {
    update((next) => {
      if (mode === "prev") next.delete("compare");
      else next.set("compare", mode);
    });
  };

  const togglePlatform = (value: string) => {
    const set = new Set(platforms);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    update((next) => {
      if (set.size === 0) next.delete("platforms");
      else next.set("platforms", [...set].join(","));
    });
  };

  const platformLabel =
    platforms.length === 0
      ? "All platforms"
      : platforms.length === 1
        ? PLATFORMS.find((p) => p.value === platforms[0])?.label ?? "1"
        : `${platforms.length} platforms`;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <DateRangePicker
        from={from}
        to={to}
        onChange={setRange}
        remember
        fallback={
          defaultFrom && defaultTo
            ? { from: defaultFrom, to: defaultTo }
            : undefined
        }
      />

      {/* Comparison mode */}
      <div className="inline-flex items-center rounded-md border border-line bg-surface-2 p-0.5 text-xs">
        {COMPARE.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => setCompare(c.value)}
            className={cn(
              "px-2.5 py-1 rounded transition-colors",
              compare === c.value
                ? "bg-surface text-ink shadow-sm"
                : "text-ink-3 hover:text-ink",
            )}
            title={
              c.value === "prev"
                ? "Compare to the immediately prior period"
                : c.value === "wow"
                  ? "Compare to 7 days earlier"
                  : "Compare to 30 days earlier"
            }
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Platforms */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-2 h-8 px-3 rounded-md border text-xs transition-colors",
              platforms.length > 0
                ? "border-brand/50 text-ink bg-[var(--brand-soft)]"
                : "border-line text-ink-2 bg-surface hover:bg-surface-2 hover:text-ink",
            )}
          >
            <Layers className="w-3.5 h-3.5" />
            <span className="text-ink">{platformLabel}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuLabel>Platforms</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {PLATFORMS.map((p) => (
            <DropdownMenuCheckboxItem
              key={p.value}
              checked={platforms.includes(p.value)}
              onCheckedChange={() => togglePlatform(p.value)}
              onSelect={(e) => e.preventDefault()}
            >
              {p.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Campaign search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-3" />
        <input
          type="text"
          value={qLocal}
          onChange={(e) => setQLocal(e.target.value)}
          placeholder="Search campaigns…"
          className="h-8 w-48 pl-8 pr-7 rounded-md border border-line bg-surface text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:border-brand/50"
        />
        {qLocal && (
          <button
            type="button"
            onClick={() => setQLocal("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
