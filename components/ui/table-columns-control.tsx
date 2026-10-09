"use client";

import { useRef, useState } from "react";
import { ChevronDown, ChevronUp, Columns3, GripVertical, Lock } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * The ONE columns control, living on `DataTable` itself (2026-10).
 *
 * It sits in the table's own corner — a slim row immediately above the header,
 * flush with the table's right edge — because columns belong to the TABLE, not
 * to a page toolbar. Every table that passes a `columnsKey` gets it, and the
 * toolbar dropdowns pages used to hand-roll are retired as they migrate.
 *
 * THE LIST IS THE COLUMN CONFIG, in current display order: a page never lists
 * its columns twice, so a renamed or added column appears here by itself. The
 * PINNED identity column is shown first with a lock and no controls — it is
 * what every other column is read against, and hiding it would leave rows
 * nobody can identify.
 *
 * REORDERING IS NOT DRAG-ONLY. The grip is there for a mouse, but the up/down
 * buttons (and Alt+↑/↓) are the real interface: touch and keyboard must be able
 * to do everything the mouse can.
 */
export interface ColumnsControlItem {
  key: string;
  label: string;
  pinned?: boolean;
}

export function TableColumnsControl({
  columnsKey,
  items,
  hidden,
  dirty,
  onToggle,
  onMove,
  onReset,
}: {
  columnsKey: string;
  /** Every column, in current display order, pinned first. */
  items: ColumnsControlItem[];
  hidden: readonly string[];
  /** Anything saved? Drives the dot on the button and enables Reset. */
  dirty: boolean;
  onToggle: (key: string) => void;
  onMove: (key: string, delta: number) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const hiddenSet = new Set(hidden);
  const movable = items.filter((c) => !c.pinned);
  const shown = movable.filter((c) => !hiddenSet.has(c.key)).length;

  /** Arrow keys walk the rows; Space toggles; Alt+↑/↓ moves. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, item: ColumnsControlItem) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (e.altKey) {
        if (item.pinned) return;
        e.preventDefault();
        onMove(item.key, e.key === "ArrowDown" ? 1 : -1);
        return;
      }
      e.preventDefault();
      const rows = Array.from(
        listRef.current?.querySelectorAll<HTMLElement>("[data-col-row]") ?? [],
      );
      const i = rows.findIndex((r) => r === e.currentTarget);
      const next = rows[e.key === "ArrowDown" ? i + 1 : i - 1];
      next?.focus();
      return;
    }
    if (e.key === " " || e.key === "Enter") {
      if (item.pinned) return;
      e.preventDefault();
      onToggle(item.key);
    }
  };

  return (
    <div className="flex justify-end">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title="Columns"
            aria-label={`Columns (${shown} of ${movable.length} shown)`}
            className={cn(
              "relative inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink",
              open && "bg-surface-2 text-ink",
            )}
          >
            <Columns3 className="h-3.5 w-3.5" />
            {/* A quiet mark that this table is not at its defaults. */}
            {dirty && (
              <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-brand" />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-0">
          <div className="border-b border-line px-3 py-2">
            <p className="text-xs font-medium text-ink">Columns</p>
            <p className="text-[11px] text-ink-3">
              {shown} of {movable.length} shown · drag or use ↑↓
            </p>
          </div>

          <div ref={listRef} className="max-h-72 overflow-y-auto py-1">
            {items.map((item, i) => {
              const isHidden = hiddenSet.has(item.key);
              return (
                <div
                  key={item.key}
                  data-col-row
                  tabIndex={0}
                  onKeyDown={(e) => onKeyDown(e, item)}
                  className={cn(
                    "group flex items-center gap-2 px-2 py-1.5 text-xs outline-none",
                    "focus-visible:bg-surface-2 hover:bg-surface-2",
                  )}
                >
                  {item.pinned ? (
                    <>
                      <Lock className="h-3 w-3 shrink-0 text-ink-3" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-ink-2">
                        {item.label}
                      </span>
                      <span className="text-[10px] text-ink-3">pinned</span>
                    </>
                  ) : (
                    <>
                      <span
                        draggable
                        onDragStart={(e) =>
                          e.dataTransfer.setData("text/column", item.key)
                        }
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          const from = e.dataTransfer.getData("text/column");
                          if (!from || from === item.key) return;
                          const order = movable.map((c) => c.key);
                          onMove(from, order.indexOf(item.key) - order.indexOf(from));
                        }}
                        title="Drag to reorder"
                        className="cursor-grab text-ink-3/50 transition-colors hover:text-ink active:cursor-grabbing"
                      >
                        <GripVertical className="h-3 w-3" />
                      </span>
                      <input
                        id={`${columnsKey}-col-${item.key}`}
                        type="checkbox"
                        checked={!isHidden}
                        onChange={() => onToggle(item.key)}
                        className="h-3 w-3 shrink-0 accent-[var(--brand)]"
                      />
                      <label
                        htmlFor={`${columnsKey}-col-${item.key}`}
                        className={cn(
                          "min-w-0 flex-1 cursor-pointer truncate",
                          isHidden ? "text-ink-3" : "text-ink-2",
                        )}
                      >
                        {item.label}
                      </label>
                      {/* Visible on hover/focus, but ALWAYS reachable by tab —
                          hiding an affordance from the keyboard is hiding it. */}
                      <span className="flex items-center opacity-0 transition-opacity focus-within:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100">
                        <button
                          type="button"
                          aria-label={`Move ${item.label} up`}
                          disabled={i <= (items[0]?.pinned ? 1 : 0)}
                          onClick={() => onMove(item.key, -1)}
                          className="rounded p-0.5 text-ink-3 hover:bg-surface-3 hover:text-ink disabled:opacity-30"
                        >
                          <ChevronUp className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${item.label} down`}
                          disabled={i === items.length - 1}
                          onClick={() => onMove(item.key, 1)}
                          className="rounded p-0.5 text-ink-3 hover:bg-surface-3 hover:text-ink disabled:opacity-30"
                        >
                          <ChevronDown className="h-3 w-3" />
                        </button>
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex justify-end border-t border-line px-2 py-1.5">
            <button
              type="button"
              onClick={onReset}
              disabled={!dirty}
              className="rounded-md px-2 py-1 text-[11px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Reset to default
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
