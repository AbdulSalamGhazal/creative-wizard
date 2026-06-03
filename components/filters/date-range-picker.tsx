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
import {
  activePresetKey,
  DATE_PRESETS,
  isoToLocalDate,
  localDateToIso,
  presetLabel,
  todayIso,
} from "@/lib/date-presets";

/**
 * Reusable date-range control: the full preset list + a custom two-month
 * calendar. Presentational — the parent owns where the range goes (URL params,
 * state, …) via `onChange`. Passing `null, null` means Lifetime / all-time.
 *
 * Conversions go through lib/date-presets so the picked day never shifts
 * across the UTC boundary.
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
      return { from: isoToLocalDate(from), to: isoToLocalDate(to) };
    }
    return undefined;
  }, [from, to]);
  const [pending, setPending] = useState<DateRange | undefined>(initial);

  const label = useMemo(() => presetLabel(from, to), [from, to]);
  const presetActive = activePresetKey(from, to);

  const applyCustom = () => {
    if (pending?.from && pending.to) {
      onChange(localDateToIso(pending.from), localDateToIso(pending.to));
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
          <div className="w-52 p-1">
            <div className="px-2 py-1.5 text-[11px] uppercase tracking-[0.14em] text-ink-3">
              Date range
            </div>
            <div className="space-y-0.5 max-h-80 overflow-y-auto">
              {DATE_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => {
                    const res = p.range(todayIso());
                    if (res) onChange(res.from, res.to);
                    else onChange(null, null);
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
