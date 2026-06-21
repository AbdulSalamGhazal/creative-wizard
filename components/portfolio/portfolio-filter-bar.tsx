"use client";

import { Columns3, Layers, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DateRangePicker } from "@/components/filters/date-range-picker";
import { ViewsControl } from "@/components/summary/views-control";
import { CAMPAIGN_TABLE_COLUMNS } from "@/components/portfolio/portfolio-table";
import type { SummaryViewRow } from "@/db/queries/summary-views";
import { cn } from "@/lib/utils";

const PLATFORMS = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "tiktok", label: "TikTok" },
  { value: "snapchat", label: "Snapchat" },
] as const;

function csv(v: string | null): string[] {
  return v ? v.split(",").filter(Boolean) : [];
}

export function PortfolioFilterBar({
  defaultFrom,
  defaultTo,
  views,
  currentUserId,
  isAdmin,
}: {
  /** Effective default range (user's saved choice) for the picker label. */
  defaultFrom?: string;
  defaultTo?: string;
  views: SummaryViewRow[];
  currentUserId: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const platforms = useMemo(
    () => csv(searchParams.get("platforms")),
    [searchParams],
  );
  const hiddenCols = useMemo(
    () => new Set(csv(searchParams.get("hide"))),
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

  // Debounced campaign search. The input is the source of truth while typing;
  // we only adopt a `q` change we DIDN'T originate (Clear, back/forward) so a
  // late-landing navigation can't reset the field and eat typed characters.
  const [qLocal, setQLocal] = useState(qParam);
  const pendingQPushes = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (pendingQPushes.current.has(qParam)) {
      pendingQPushes.current.delete(qParam);
      return;
    }
    pendingQPushes.current.clear();
    setQLocal(qParam);
  }, [qParam]);
  useEffect(() => {
    const trimmed = qLocal.trim();
    if (trimmed === qParam) return;
    const t = setTimeout(() => {
      pendingQPushes.current.add(trimmed);
      update((next) => {
        if (trimmed) next.set("q", trimmed);
        else next.delete("q");
      });
    }, 300);
    return () => clearTimeout(t);
  }, [qLocal, qParam, update]);

  const setRange = (f: string | null, t: string | null) => {
    update((next) => {
      if (f) next.set("from", f);
      else next.delete("from");
      if (t) next.set("to", t);
      else next.delete("to");
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

  const toggleColumn = (key: string) => {
    const set = new Set(hiddenCols);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    update((next) => {
      if (set.size === 0) next.delete("hide");
      else next.set("hide", [...set].join(","));
    });
  };

  const platformLabel =
    platforms.length === 0
      ? "All platforms"
      : platforms.length === 1
        ? PLATFORMS.find((p) => p.value === platforms[0])?.label ?? "1"
        : `${platforms.length} platforms`;

  const shownCount = CAMPAIGN_TABLE_COLUMNS.filter((c) => !hiddenCols.has(c.key)).length;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <ViewsControl
        views={views}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
        page="campaigns"
        clearLabel="Show all campaigns (ignore default)"
      />

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

      {/* Columns */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-2 h-8 px-3 rounded-md border border-line text-xs text-ink-2 bg-surface hover:bg-surface-2 hover:text-ink transition-colors"
          >
            <Columns3 className="w-3.5 h-3.5" />
            <span className="text-ink">Columns</span>
            <span className="text-ink-3">{shownCount}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44 max-h-80 overflow-y-auto">
          <DropdownMenuLabel>Columns</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {CAMPAIGN_TABLE_COLUMNS.map((c) => (
            <DropdownMenuCheckboxItem
              key={c.key}
              checked={!hiddenCols.has(c.key)}
              onCheckedChange={() => toggleColumn(c.key)}
              onSelect={(e) => e.preventDefault()}
            >
              {c.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
