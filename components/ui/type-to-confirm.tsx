"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * THE type-to-confirm field — the last step of an UNRECOVERABLE delete
 * (ux-standards "Economy": preview → acknowledge → type-to-confirm). The two
 * cleanup tools typed DELETE in their own copies of this markup; deleting a
 * creative or a campaign — every one of its records goes — needed only a
 * checkbox (D23, 2026-10). Now one field: type the `phrase` (the entity's own
 * name, or DELETE) and the caller's button unlocks on `confirmMatches`.
 */
export function confirmMatches(typed: string, phrase: string, caseInsensitive = false): boolean {
  const a = typed.trim();
  const b = phrase.trim();
  return caseInsensitive ? a.toUpperCase() === b.toUpperCase() : a === b;
}

export function TypeToConfirm({
  phrase,
  value,
  onChange,
  disabled,
  className,
  inputClassName = "mt-1 h-8 max-w-[220px]",
}: {
  /** What must be typed — shown in the label, and as the placeholder. */
  phrase: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="text-[11px] text-ink-3">
        Type <span className="break-all font-mono text-neg">{phrase}</span> to confirm
      </label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={phrase}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        className={cn(inputClassName)}
      />
    </div>
  );
}
