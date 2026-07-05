"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, Plus, Tag as TagIcon, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Multi-select tag dropdown: pick from the existing tag library (checkbox
 * list) and/or type a brand-new tag and press Enter / "Add". Selected tags
 * render as removable chips beneath the trigger. Presentational — the parent
 * owns persistence via `onChange`.
 */
export function TagMultiSelect({
  value,
  onChange,
  allTags,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  allTags: string[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const selected = useMemo(() => new Set(value), [value]);

  // The full option list: library tags ∪ whatever is currently selected
  // (so a freshly-added tag still shows as a checked row), sorted, filtered
  // by the typed query.
  const options = useMemo(() => {
    const all = Array.from(new Set([...allTags, ...value])).sort((a, b) =>
      a.localeCompare(b),
    );
    const q = draft.trim().toLowerCase();
    return q ? all.filter((t) => t.toLowerCase().includes(q)) : all;
  }, [allTags, value, draft]);

  const toggle = (tag: string) => {
    if (selected.has(tag)) onChange(value.filter((t) => t !== tag));
    else onChange([...value, tag]);
  };

  const addDraft = () => {
    const t = draft.trim();
    if (!t) return;
    if (!selected.has(t)) onChange([...value, t]);
    setDraft("");
  };

  const exactExists = options.some(
    (t) => t.toLowerCase() === draft.trim().toLowerCase(),
  );

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "inline-flex items-center gap-2 h-8 px-3 rounded-md border text-xs transition-colors disabled:opacity-60",
              "border-line bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink",
            )}
          >
            <TagIcon className="w-3.5 h-3.5" />
            <span>
              {value.length === 0
                ? "Add tags"
                : `${value.length} tag${value.length === 1 ? "" : "s"} selected`}
            </span>
            <ChevronDown className="w-3 h-3 text-ink-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-0">
          <div className="p-2 border-b border-line">
            <div className="flex items-center gap-1.5">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addDraft();
                  }
                }}
                placeholder="Search or add a tag…"
                className="h-8 flex-1 rounded-md border border-line bg-surface px-2 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-brand"
              />
              {draft.trim() && !exactExists && (
                <button
                  type="button"
                  onClick={addDraft}
                  className="inline-flex items-center gap-1 h-8 px-2 rounded-md bg-brand text-primary-foreground text-[11px] whitespace-nowrap"
                >
                  <Plus className="w-3 h-3" />
                  Add
                </button>
              )}
            </div>
          </div>
          <div className="max-h-56 overflow-auto p-1">
            {options.length === 0 ? (
              <div className="px-2 py-3 text-center text-[11px] text-ink-3">
                {draft.trim()
                  ? "No matches — press Add to create it."
                  : "No tags yet. Type one above."}
              </div>
            ) : (
              options.map((tag) => {
                const isSel = selected.has(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggle(tag)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-ink-2 hover:bg-surface-2 hover:text-ink"
                  >
                    <span
                      className={cn(
                        "inline-flex items-center justify-center w-4 h-4 rounded border",
                        isSel
                          ? "bg-brand border-brand text-primary-foreground"
                          : "border-line",
                      )}
                    >
                      {isSel && <Check className="w-3 h-3" />}
                    </span>
                    <span className="flex-1 text-left truncate">{tag}</span>
                  </button>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>

      {value.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {value.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded text-[11px] bg-surface-2 border border-line text-ink-2"
            >
              {t}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(value.filter((x) => x !== t))}
                className="inline-flex items-center justify-center w-4 h-4 rounded hover:bg-line text-ink-3 hover:text-neg transition-colors"
                aria-label={`Remove ${t}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
