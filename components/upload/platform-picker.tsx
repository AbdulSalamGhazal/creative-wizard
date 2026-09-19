"use client";

import { Check } from "lucide-react";
import { ALL_PLATFORMS, PLATFORM_LABEL } from "@/lib/palette";
import { PlatformDot } from "@/components/ui/platform-dot";
import { cn } from "@/lib/utils";

/** Derived from the canonical platform list — a new platform shows up here. */
export const PLATFORMS = ALL_PLATFORMS.map((value) => ({
  value,
  label: PLATFORM_LABEL[value],
}));

export type Platform = (typeof ALL_PLATFORMS)[number];

interface Props {
  value: Platform | null;
  onChange: (v: Platform) => void;
  disabled?: boolean;
}

/**
 * Platform selector, one button per canonical platform. No default — the team
 * picks explicitly so "wrong platform" mistakes can't ride through silently.
 */
export function PlatformPicker({ value, onChange, disabled }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Platform"
      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2"
    >
      {PLATFORMS.map((p) => {
        const selected = value === p.value;
        return (
          <button
            key={p.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(p.value)}
            className={cn(
              "relative rounded-lg border bg-surface px-4 py-3 text-left transition-colors",
              "hover:border-line-2 disabled:opacity-50 disabled:cursor-not-allowed",
              selected
                ? "border-brand/60 bg-[var(--brand-soft)] ring-1 ring-brand/40"
                : "border-line",
            )}
          >
            <div className="flex items-center gap-2">
              <PlatformDot platform={p.value} />
              <span
                className={cn(
                  "text-sm",
                  selected ? "text-ink font-semibold" : "text-ink-2",
                )}
              >
                {p.label}
              </span>
              {selected && (
                <Check className="ml-auto w-4 h-4 text-brand" />
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
