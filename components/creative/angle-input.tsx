"use client";

import { useMemo } from "react";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";

interface Props {
  /** Current angle input string (comma-separated). */
  value: string;
  onChange: (next: string) => void;
  /** All angles that already exist on any creative. */
  allAngles: string[];
  placeholder?: string;
  disabled?: boolean;
}

function parseAngles(s: string): string[] {
  return s
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Angle editor with autocomplete-by-click. Stays a comma-separated text input
 * so users can paste a list, but renders the existing-angle library as
 * clickable suggestions; one click appends. Angles already in the input are
 * shown disabled so the user knows what's in vs. out.
 */
export function AngleInput({
  value,
  onChange,
  allAngles,
  placeholder = "launch, ugc, cold-traffic",
  disabled,
}: Props) {
  const selected = useMemo(() => new Set(parseAngles(value)), [value]);

  const addAngle = (angle: string) => {
    if (selected.has(angle)) return;
    const existing = parseAngles(value);
    const next = [...existing, angle].join(", ");
    onChange(next);
  };

  const suggestions = useMemo(
    () => allAngles.filter((t) => !selected.has(t)).sort(),
    [allAngles, selected],
  );

  return (
    <div className="space-y-2">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
      {allAngles.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-eyebrow text-ink-3">
            From your library
          </div>
          <div className="flex flex-wrap gap-1.5">
            {allAngles.map((angle) => {
              const isSelected = selected.has(angle);
              return (
                <button
                  key={angle}
                  type="button"
                  disabled={disabled || isSelected}
                  onClick={() => addAngle(angle)}
                  className={
                    isSelected
                      ? "inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] bg-surface-2 border border-line text-ink-3 cursor-not-allowed opacity-70"
                      : "inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] bg-surface border border-line text-ink-2 hover:bg-surface-2 hover:text-ink transition-colors"
                  }
                >
                  {!isSelected && <Plus className="w-2.5 h-2.5" />}
                  <span>{angle}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
