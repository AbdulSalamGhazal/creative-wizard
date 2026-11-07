"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from "react";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/ui/form-error";
import { cn } from "@/lib/utils";

/**
 * The ONE form field (R-053): a label, the control, then a hint or an error
 * line. Every form draws its fields through it — the create forms, the edit
 * dialogs, the creative detail editor and Price Structure's dense grids — so
 * a label looks the same everywhere (shadcn `Label`, text-sm medium; `size=
 * "sm"` is text-xs for dense grids) and the hint/error is wired to the
 * control: the line gets an id, and a single element child gets
 * `aria-describedby` (and `aria-invalid` while there's an error).
 *
 * Without `htmlFor` (a picker made of several buttons) the label names the
 * field as a group instead.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  tip,
  aside,
  size = "md",
  inline = false,
  className,
  children,
}: {
  label: ReactNode;
  /** The control's id, so the label names it and a tap on it focuses it. */
  htmlFor?: string;
  /** One short line under the control — a unit, a rule. */
  hint?: ReactNode;
  /** The field's failure; replaces the hint and is announced. */
  error?: string | null;
  /** Beside the label — an `InfoTip`, the reason a control is locked. */
  tip?: ReactNode;
  /** At the label row's far end — a status badge. */
  aside?: ReactNode;
  /** `md` (text-sm label) or `sm` (text-xs label, for dense grids). */
  size?: "md" | "sm";
  /** Label and control on one row (a settings switch). */
  inline?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const labelId = useId();
  const noteId = useId();
  const hasError = !!error;
  const hasNote = hasError || (hint !== null && hint !== undefined && hint !== "");

  // Wire the note to a single element child (an Input, a SelectTrigger …).
  let control = children;
  const only = Children.count(children) === 1 ? Children.toArray(children)[0] : null;
  if (hasNote && isValidElement(only)) {
    const el = only as ReactElement<Record<string, unknown>>;
    const prior = el.props["aria-describedby"];
    control = cloneElement(el, {
      "aria-describedby": [prior, noteId].filter(Boolean).join(" "),
      ...(hasError ? { "aria-invalid": true } : {}),
    });
  }

  const labelRow = (
    <div className={cn("flex items-center gap-1.5", aside ? "justify-between gap-3" : null)}>
      <span className="flex min-w-0 items-center gap-1.5">
        <Label
          id={labelId}
          htmlFor={htmlFor}
          className={size === "sm" ? "text-xs" : undefined}
        >
          {label}
        </Label>
        {tip}
      </span>
      {aside}
    </div>
  );

  return (
    <div
      className={cn(
        inline ? "flex items-center justify-between gap-3" : size === "sm" ? "space-y-1" : "space-y-1.5",
        className,
      )}
      {...(htmlFor ? {} : { role: "group", "aria-labelledby": labelId })}
    >
      {labelRow}
      {control}
      {hasError ? (
        <FormError id={noteId} className="text-[11px]">
          {error}
        </FormError>
      ) : hasNote ? (
        <p id={noteId} className="text-[11px] text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
