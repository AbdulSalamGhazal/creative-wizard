"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

/** One choice: its id, its name, and a quiet hint beside it (a network, a count). */
export interface SearchSelectOption {
  id: string;
  name: string;
  hint?: string;
}

/**
 * A searchable single-select — one of a long list, found by typing. It began
 * as the Exclusions rule form's own picker; "New ad set" needed the same
 * control for the same list (a brand's campaigns), so it lives here once
 * (2026-11). Picking the chosen option again clears it.
 */
export function SearchSelect({
  options,
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  hintInTrigger = false,
  id,
  disabled,
}: {
  options: SearchSelectOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** The closed control's words while nothing is picked. */
  placeholder: string;
  /** The search box's words — the placeholder's when not given. */
  searchPlaceholder?: string;
  /** Show the picked option's hint in the closed control too. */
  hintInTrigger?: boolean;
  /** The trigger's id — what a `Field`'s label points at. */
  id?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-line bg-surface px-3 text-sm hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className={cn("truncate", selected ? "text-ink" : "text-ink-3")} dir="auto">
            {selected ? selected.name : placeholder}
          </span>
          {hintInTrigger && selected?.hint && (
            <span className="ml-auto shrink-0 text-[11px] text-ink-2">{selected.hint}</span>
          )}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <Command
          filter={(v, search) => (v.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}
        >
          <CommandInput placeholder={searchPlaceholder ?? placeholder} />
          <CommandList className="max-h-72">
            <CommandEmpty>Nothing found.</CommandEmpty>
            {options.map((o) => (
              <CommandItem
                key={o.id}
                value={`${o.name} ${o.hint ?? ""}`}
                onSelect={() => {
                  onChange(o.id === value ? null : o.id);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 text-brand",
                    o.id === value ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="truncate text-xs">{o.name}</span>
                {o.hint && (
                  <span className="ml-auto truncate text-[11px] text-ink-3">{o.hint}</span>
                )}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
