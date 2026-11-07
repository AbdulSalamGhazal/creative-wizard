"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { UnitInput } from "@/components/ui/unit-input";
import { cn } from "@/lib/utils";
import { Field as SharedField } from "@/components/ui/field";

/**
 * The module's form atoms. Every number field commits on each keystroke
 * (the brief: results update as you type) while keeping the text the person
 * typed, so "12." is not snapped to "12" under their cursor; a value changed
 * elsewhere (another tab) replaces the text once the field loses focus.
 */
/** The shared form field (R-053) at its dense size — the module's grids. */
export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
  inline = false,
}: {
  label: ReactNode;
  /** One short line under the control — a unit, a rule. */
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
  /** Label and control on one row (the settings drawer's switch). */
  inline?: boolean;
}) {
  return (
    <SharedField
      size="sm"
      label={label}
      hint={hint}
      htmlFor={htmlFor}
      inline={inline}
      className={className}
    >
      {children}
    </SharedField>
  );
}

const fmt = (v: number, pct: boolean): string => {
  if (!Number.isFinite(v)) return "";
  // Percentages read as typed (85, 12.5) with at most 2 decimals — a third of
  // the orders is "33.33", not "33.3333"; money and rates keep up to 4.
  const shown = pct ? Math.round(v * 1e4) / 1e2 : Math.round(v * 1e4) / 1e4;
  return String(shown);
};

export function NumberField({
  value,
  onChange,
  unit,
  pct = false,
  integer = false,
  min,
  max,
  id,
  ariaLabel,
  className,
  wrapperClassName,
  disabled,
  placeholder,
  size = "sm",
}: {
  value: number;
  onChange: (next: number) => void;
  /** Shown inside the box: "SAR", "%", "$", "×". */
  unit?: string;
  /** The stored value is a fraction; the field shows and takes percentages. */
  pct?: boolean;
  integer?: boolean;
  /** Bounds applied to what is COMMITTED (in the field's own unit); the text is left alone. */
  min?: number;
  max?: number;
  id?: string;
  ariaLabel?: string;
  className?: string;
  wrapperClassName?: string;
  disabled?: boolean;
  placeholder?: string;
  size?: "sm" | "xs";
}) {
  const [text, setText] = useState(() => fmt(value, pct));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(fmt(value, pct));
  }, [value, pct, focused]);

  const commit = (raw: string) => {
    setText(raw);
    const n = Number(raw.replace(/,/g, "").trim());
    if (raw.trim() === "" || !Number.isFinite(n)) return;
    let v = integer ? Math.round(n) : n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onChange(pct ? v / 100 : v);
  };

  const common = {
    id,
    "aria-label": ariaLabel,
    type: "text" as const,
    inputMode: (integer ? "numeric" : "decimal") as "numeric" | "decimal",
    value: text,
    disabled,
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => commit(e.target.value),
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
      setFocused(true);
      e.currentTarget.select();
    },
    onBlur: () => {
      setFocused(false);
      setText(fmt(value, pct));
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape" || e.key === "Enter") e.currentTarget.blur();
    },
    className: cn(size === "xs" ? "h-7 text-xs" : "h-8 text-sm", "tabular-nums", className),
  };
  if (unit) return <UnitInput {...common} unit={unit} wrapperClassName={wrapperClassName} />;
  return <Input {...common} className={cn(common.className, "text-right")} />;
}

export function TextField({
  value,
  onChange,
  id,
  placeholder,
  ariaLabel,
  className,
  dir = "auto",
}: {
  value: string;
  onChange: (next: string) => void;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  dir?: "auto" | "ltr" | "rtl";
}) {
  return (
    <Input
      id={id}
      aria-label={ariaLabel}
      dir={dir}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={cn("h-8 text-sm", className)}
    />
  );
}

/** A labelled number field with an id wired up, for forms. */
export function LabelledNumber(props: Parameters<typeof NumberField>[0] & { label: ReactNode; hint?: ReactNode }) {
  const id = useId();
  const { label, hint, ...rest } = props;
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <NumberField {...rest} id={id} />
    </Field>
  );
}
