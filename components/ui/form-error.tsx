import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A form's inline failure line (R-032). The house rule shows a form's failure
 * ONCE, inline, never also as a toast — so for a screen reader this line is
 * the only signal, and it must be announced: `role="alert"`. Pass its `id` to
 * the failing control's `aria-describedby` and set `aria-invalid` there.
 * Renders nothing without a message, so a form can mount it unconditionally.
 */
export function FormError({
  id,
  children,
  className,
}: {
  id?: string;
  children?: ReactNode;
  className?: string;
}) {
  if (children === null || children === undefined || children === false || children === "") {
    return null;
  }
  return (
    <p id={id} role="alert" className={cn("text-xs text-neg", className)}>
      {children}
    </p>
  );
}
