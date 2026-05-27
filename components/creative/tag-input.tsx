"use client";

import { useMemo } from "react";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";

interface Props {
  /** Current tag input string (comma-separated). */
  value: string;
  onChange: (next: string) => void;
  /** All tags that already exist on any creative. */
  allTags: string[];
  placeholder?: string;
  disabled?: boolean;
}

function parseTags(s: string): string[] {
  return s
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Tag editor with autocomplete-by-click. Stays a comma-separated text input
 * so users can paste a list, but renders the existing-tag library as
 * clickable suggestions; one click appends. Tags already in the input are
 * shown disabled so the user knows what's in vs. out.
 */
export function TagInput({
  value,
  onChange,
  allTags,
  placeholder = "launch, ugc, cold-traffic",
  disabled,
}: Props) {
  const selected = useMemo(() => new Set(parseTags(value)), [value]);

  const addTag = (tag: string) => {
    if (selected.has(tag)) return;
    const existing = parseTags(value);
    const next = [...existing, tag].join(", ");
    onChange(next);
  };

  const suggestions = useMemo(
    () => allTags.filter((t) => !selected.has(t)).sort(),
    [allTags, selected],
  );

  return (
    <div className="space-y-2">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
      {allTags.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-[0.14em] text-ink-3">
            From your library
          </div>
          <div className="flex flex-wrap gap-1.5">
            {allTags.map((tag) => {
              const isSelected = selected.has(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  disabled={disabled || isSelected}
                  onClick={() => addTag(tag)}
                  className={
                    isSelected
                      ? "inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] bg-surface-2 border border-line text-ink-3 cursor-not-allowed opacity-70"
                      : "inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] bg-surface border border-line text-ink-2 hover:bg-surface-2 hover:text-ink transition-colors"
                  }
                >
                  {!isSelected && <Plus className="w-2.5 h-2.5" />}
                  <span>{tag}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
