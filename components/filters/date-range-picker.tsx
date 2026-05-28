"use client";

import { useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PRESETS = [
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function presetRange(days: number): { from: string; to: string } {
  const to = new Date();
  to.setUTCHours(0, 0, 0, 0);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from: isoDate(from), to: isoDate(to) };
}
function activePresetKey(from: string | null, to: string | null): string | null {
  if (!from || !to) return null;
  for (const p of PRESETS) {
    const r = presetRange(p.days);
    if (r.from === from && r.to === to) return p.key;
  }
  return null;
}

/**
 * Reusable date-range control: presets + a custom two-month calendar, plus
 * an "All time" reset. Presentational — the parent owns where the range
 * goes (URL params, state, …) via `onChange`. Passing `null, null` means
 * all-time / cleared.
 */
export function DateRangePicker({
  from,
  to,
  onChange,
}: {
  from: string | null;
  to: string | null;
  onChange: (from: string | null, to: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"presets" | "custom">("presets");

  const initial: DateRange | undefined = useMemo(() => {
    if (from && to) {
      return {
        from: new Date(`${from}T00:00:00Z`),
        to: new Date(`${to}T00:00:00Z`),
      };
    }
    return undefined;
  }, [from, to]);
  const [pending, setPending] = useState<DateRange | undefined>(initial);

  const label = useMemo(() => {
    const key = activePresetKey(from, to);
    if (key) return PRESETS.find((p) => p.key === key)!.label;
    if (from && to) return `${from} → ${to}`;
    return "All time";
  }, [from, to]);

  const presetActive = activePresetKey(from, to);

  const applyCustom = () => {
    if (pending?.from && pending.to) {
      onChange(isoDate(pending.from), isoDate(pending.to));
      setOpen(false);
      setMode("presets");
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setMode("presets");
          setPending(initial);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-2 h-8 px-3 rounded-md border text-xs transition-colors",
            from || to
              ? "border-brand/50 text-ink bg-[var(--brand-soft)]"
              : "border-line text-ink-2 bg-surface hover:bg-surface-2 hover:text-ink",
          )}
        >
          <CalendarDays className="w-3.5 h-3.5" />
          <span className="text-ink-3">Date</span>
          <span className="text-ink">{label}</span>
          <ChevronDown className="w-3 h-3 text-ink-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="p-0 w-auto">
        {mode === "presets" ? (
          <div className="w-56 p-1">
            <div className="px-2 py-1.5 text-[11px] uppercase tracking-[0.14em] text-ink-3">
              Date range
            </div>
            <div className="space-y-0.5">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => {
                    const r = presetRange(p.days);
                    onChange(r.from, r.to);
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-ink-2 hover:bg-surface-2 hover:text-ink"
                >
                  <span className="flex-1 text-left">{p.label}</span>
                  {presetActive === p.key && (
                    <Check className="w-3.5 h-3.5 text-brand" />
                  )}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setMode("custom")}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-ink-2 hover:bg-surface-2 hover:text-ink border-t border-line mt-1"
              >
                <span className="flex-1 text-left">Custom range…</span>
              </button>
              {(from || to) && (
                <button
                  type="button"
                  onClick={() => {
                    onChange(null, null);
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-ink-3 hover:bg-surface-2 hover:text-ink"
                >
                  <span className="flex-1 text-left">All time</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="p-3 space-y-3">
            <Calendar
              mode="range"
              numberOfMonths={2}
              defaultMonth={pending?.from ?? new Date()}
              selected={pending}
              onSelect={setPending}
            />
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setMode("presets")}
              >
                Back
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={applyCustom}
                disabled={!pending?.from || !pending?.to}
              >
                Apply
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
