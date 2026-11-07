"use client";

import { cn } from "@/lib/utils";

/**
 * The canonical chart legend for togglable series — a row of colored chips you
 * click to show/hide a line. One look everywhere (funnel rate lines, campaign
 * creative lines, etc.) instead of each chart re-implementing the chip.
 *
 * SOLO (R-085, 2026-11): Alt/Option-click — or double-click, for touch — a chip
 * to show ONLY that series; solo the one series already alone to bring every
 * series back. It is driven through `onToggle` (one flip per series whose
 * state changes), so every caller gets it with no new prop; callers' toggles
 * are functional updates, so the flips compose.
 */
/** The keys to flip so `key` is shown alone — or, when it already is, so
 *  every series is shown again. */
export function soloFlips(
  items: ReadonlyArray<{ key: string }>,
  shown: ReadonlySet<string>,
  key: string,
): string[] {
  const alone = shown.size === 1 && shown.has(key);
  return items.filter((it) => shown.has(it.key) !== (alone || it.key === key)).map((it) => it.key);
}

export function SeriesLegend({
  items,
  shown,
  onToggle,
  onShowAll,
  className,
}: {
  items: ReadonlyArray<{ key: string; label: string; color: string }>;
  shown: ReadonlySet<string>;
  onToggle: (key: string) => void;
  /** When set, a "Show all" reset chip appears while any series is hidden. */
  onShowAll?: () => void;
  className?: string;
}) {
  const hasHidden = shown.size < items.length;
  const solo = (key: string) => soloFlips(items, shown, key).forEach(onToggle);
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {items.map((it) => {
        const on = shown.has(it.key);
        return (
          <button
            key={it.key}
            type="button"
            onClick={(e) => (e.altKey ? solo(it.key) : onToggle(it.key))}
            // Two clicks have already flipped and un-flipped the chip.
            onDoubleClick={() => solo(it.key)}
            aria-pressed={on}
            title={`${it.label} · Click to ${on ? "hide" : "show"} · Alt-click to show only this`}
            className={cn(
              "inline-flex items-center gap-1.5 h-6 px-2 rounded-md border text-[11px] max-w-[14rem] transition-colors",
              on
                ? "border-line bg-surface-2 text-ink"
                : "border-line text-ink-3 hover:text-ink line-through opacity-60",
            )}
          >
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ background: it.color }}
            />
            <span className="truncate">{it.label}</span>
          </button>
        );
      })}
      {onShowAll && hasHidden && (
        <button
          type="button"
          onClick={onShowAll}
          aria-label="Show all series"
          title="Show all series"
          className="inline-flex items-center h-6 px-2 rounded-md border border-line text-[11px] text-ink-2 hover:text-ink hover:bg-surface-2 transition-colors"
        >
          Show all
        </button>
      )}
    </div>
  );
}
