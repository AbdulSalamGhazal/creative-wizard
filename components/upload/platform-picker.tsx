"use client";

import { Check } from "lucide-react";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { cn } from "@/lib/utils";

export const PLATFORMS = [
  { value: "instagram", label: PLATFORM_LABEL.instagram },
  { value: "facebook", label: PLATFORM_LABEL.facebook },
  { value: "tiktok", label: PLATFORM_LABEL.tiktok },
  { value: "snapchat", label: PLATFORM_LABEL.snapchat },
] as const;

export type Platform = (typeof PLATFORMS)[number]["value"];

interface Props {
  value: Platform | null;
  onChange: (v: Platform) => void;
  disabled?: boolean;
}

/**
 * 4-button platform selector. No default — the team picks explicitly so
 * "wrong platform" mistakes can't ride through silently.
 */
export function PlatformPicker({ value, onChange, disabled }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Platform"
      className="grid grid-cols-2 md:grid-cols-4 gap-2"
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
              <span
                className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ background: PLATFORM_COLOR[p.value] }}
              />
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
