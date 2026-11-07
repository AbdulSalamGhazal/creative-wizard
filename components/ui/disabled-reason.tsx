"use client";

import {
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * A disabled control that explains itself (R-007, ux-standards "No dead
 * ends"). The Button primitive is `disabled:pointer-events-none` and a
 * disabled <button> takes no focus, so a reason put only in its `title` was
 * unreachable by mouse, keyboard and touch alike. While `disabled`, the
 * control sits in a focusable wrapper that carries the house InfoTip pattern:
 * hover reads the title, click / Enter / Space (and a tap) opens the reason
 * in a popover, and the control is `aria-describedby` the reason. Enabled, it
 * renders the child untouched.
 */
export function DisabledReason({
  disabled,
  reason,
  children,
}: {
  /** Whether the control is disabled for THIS reason right now. */
  disabled: boolean;
  /** Why — one sentence, in the user's words. */
  reason: string;
  /** The (disabled) control itself — one element. */
  children: ReactNode;
}) {
  const id = useId();
  if (!disabled || !isValidElement(children)) return <>{children}</>;
  const el = children as ReactElement<Record<string, unknown>>;
  const prior = el.props["aria-describedby"];
  const control = cloneElement(el, {
    "aria-describedby": [prior, id].filter(Boolean).join(" "),
    title: undefined,
  });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          aria-disabled
          title={reason}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.currentTarget.click();
            }
          }}
          className="inline-flex cursor-not-allowed rounded-md"
        >
          {control}
          <span id={id} className="sr-only">
            {reason}
          </span>
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-64 px-3 py-2 text-xs leading-relaxed text-ink-2"
      >
        {reason}
      </PopoverContent>
    </Popover>
  );
}
