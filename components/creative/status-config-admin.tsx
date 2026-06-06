"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setStatusWindow } from "@/app/actions/account";
import { cn } from "@/lib/utils";

interface BrandWindow {
  id: string;
  name: string;
  statusWindowHours: number;
}

const PRESETS = [
  { hours: 24, label: "24 h", desc: "Spent on the most recent data day only" },
  { hours: 48, label: "48 h", desc: "Last 2 data days — tolerates a 1-day gap" },
  { hours: 72, label: "72 h", desc: "Last 3 data days — slowest to flip to Pause" },
];

/**
 * Status window config.
 *
 * A creative counts as "Active" on a platform if it spent within this many
 * hours of THAT platform's own latest data day. Since data is daily-grain
 * (one row per creative × platform × campaign × date), the window rounds to
 * whole days: 24 h = the latest day only, 48 h = the last 2 days, etc.
 *
 * Configured per brand — different brands can have different thresholds.
 */
export function StatusConfigAdmin({ brands }: { brands: BrandWindow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [customValues, setCustomValues] = useState<Record<string, string>>({});

  const save = (id: string, hours: number) => {
    if (!Number.isFinite(hours) || hours < 1 || hours > 720) {
      toast.error("Window must be 1–720 hours");
      return;
    }
    startTransition(async () => {
      const res = await setStatusWindow({ id, hours });
      if (!res.ok) {
        toast.error(res.error ?? "Could not update");
        return;
      }
      toast.success("Active window updated");
      router.refresh();
    });
  };

  return (
    <div className="space-y-8">
      <div className="rounded-lg border border-line bg-surface/60 px-5 py-4 text-sm text-ink-2 space-y-1.5 max-w-2xl">
        <p>
          A creative is <strong className="text-ink">Active</strong> on a platform when it
          has spent within this window of that platform's own latest data day.
          Because uploads are per-platform and daily-grain, the window rounds to
          whole days — 24 h = the latest day only.
        </p>
        <p className="text-ink-3 text-[12px]">
          Each brand can have its own window. Changes take effect immediately on
          the next page load.
        </p>
      </div>

      <div className="space-y-6 max-w-2xl">
        {brands.map((b) => {
          const current = b.statusWindowHours;
          const customRaw = customValues[b.id] ?? "";
          const customHours = customRaw ? Math.round(Number(customRaw)) : null;

          return (
            <div key={b.id} className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-ink">{b.name}</span>
                <span className="text-[10px] uppercase tracking-wider text-ink-3 px-1.5 py-0.5 rounded bg-surface-2">
                  {current}h window
                </span>
              </div>

              {/* Preset buttons */}
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => {
                  const active = current === p.hours && !customRaw;
                  return (
                    <button
                      key={p.hours}
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        setCustomValues((v) => ({ ...v, [b.id]: "" }));
                        if (current !== p.hours) save(b.id, p.hours);
                      }}
                      title={p.desc}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-sm transition-colors",
                        active
                          ? "border-brand bg-brand/10 text-brand font-medium"
                          : "border-line bg-surface text-ink-2 hover:text-ink hover:border-line-2",
                      )}
                    >
                      {p.label}
                    </button>
                  );
                })}

                {/* Custom hours */}
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min={1}
                    max={720}
                    placeholder="Custom"
                    value={customRaw}
                    onChange={(e) =>
                      setCustomValues((v) => ({ ...v, [b.id]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && customHours) {
                        save(b.id, customHours);
                        setCustomValues((v) => ({ ...v, [b.id]: "" }));
                      }
                    }}
                    className="h-8 w-24 text-sm"
                  />
                  <span className="text-xs text-ink-3">h</span>
                  {customHours && customHours !== current && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => {
                        save(b.id, customHours);
                        setCustomValues((v) => ({ ...v, [b.id]: "" }));
                      }}
                      className="h-8 text-xs"
                    >
                      Apply
                    </Button>
                  )}
                </div>
              </div>

              {/* Description of the active preset */}
              {(() => {
                const preset = PRESETS.find((p) => p.hours === current);
                return preset ? (
                  <p className="text-[12px] text-ink-3">{preset.desc}</p>
                ) : (
                  <p className="text-[12px] text-ink-3">
                    Custom: {current}h — active if spent in the last{" "}
                    {Math.ceil(current / 24)} data day
                    {Math.ceil(current / 24) !== 1 ? "s" : ""} on each platform.
                  </p>
                );
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}
