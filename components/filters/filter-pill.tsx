"use client";

import { ChevronDown, Eye, EyeOff, Search, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * Shared filter-bar controls so every bar reads the same. The canonical pill
 * anatomy is `[icon] Label Value ⌄` — an icon, a muted label prefix, the current
 * value, and a chevron — active pills tint with the brand-soft background.
 *
 * `fullWidth` switches a control to a stacked, full-width layout for the mobile
 * filter Sheet (see `filter-sheet.tsx`); the desktop bar leaves it off.
 */

const pillBase =
  "inline-flex items-center gap-2 h-8 px-3 rounded-md border text-xs transition-colors";
const pillActive = "border-brand/50 text-ink bg-[var(--brand-soft)]";
const pillIdle =
  "border-line text-ink-2 bg-surface hover:bg-surface-2 hover:text-ink";

interface FilterPillProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  active: boolean;
  fullWidth?: boolean;
  /** Dropdown content (a `<DropdownMenuContent>`), rendered lazily. */
  children: () => React.ReactNode;
}

/** A dropdown-backed filter pill (Platforms, Products, Type, Tags, Status…). */
export function FilterPill({
  icon: Icon,
  label,
  value,
  active,
  fullWidth,
  children,
}: FilterPillProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            pillBase,
            active ? pillActive : pillIdle,
            fullWidth && "w-full justify-between",
          )}
        >
          <span className="inline-flex items-center gap-2 min-w-0">
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span className="text-ink-3 shrink-0">{label}</span>
            <span className="text-ink truncate">{value}</span>
          </span>
          <ChevronDown className="w-3 h-3 text-ink-3 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      {children()}
    </DropdownMenu>
  );
}

/** Clear-all button — X + "Clear". Render only when filters are active. */
export function ClearButton({
  onClick,
  fullWidth,
}: {
  onClick: () => void;
  fullWidth?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        pillBase,
        pillIdle,
        "text-ink-3",
        fullWidth && "w-full justify-center",
      )}
    >
      <X className="w-3 h-3" />
      Clear
    </button>
  );
}

/** Excluded-from-aggregates toggle — Eye/EyeOff + text, warn-tinted when on. */
export function ExcludedToggle({
  on,
  onToggle,
  fullWidth,
}: {
  on: boolean;
  onToggle: () => void;
  fullWidth?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={
        on
          ? "Excluded records included in totals"
          : "Excluded records hidden from totals"
      }
      className={cn(
        pillBase,
        on
          ? "border-warn/40 text-warn bg-warn/10"
          : "border-line text-ink-3 hover:text-ink hover:bg-surface-2",
        fullWidth && "w-full justify-center",
      )}
    >
      {on ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
      <span>{on ? "Excluded shown" : "Excluded hidden"}</span>
    </button>
  );
}

/** Shared search input — one width (w-64) and focus style across every bar. */
export function FilterSearch({
  value,
  onChange,
  placeholder,
  fullWidth,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  fullWidth?: boolean;
}) {
  return (
    <div className={cn("relative", fullWidth && "w-full")}>
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-3 pointer-events-none" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "h-8 pl-8 pr-3 rounded-md border border-line bg-surface text-xs text-ink",
          "placeholder:text-ink-3 outline-none focus:border-line-2",
          fullWidth ? "w-full" : "w-64",
        )}
      />
    </div>
  );
}
