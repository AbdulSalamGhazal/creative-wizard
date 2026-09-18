import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Read-only Priority display for list surfaces — the detail header's star
 * control at a smaller size. Unrated renders an em-dash, never zero stars
 * (an unrated creative hasn't been judged; it isn't a 0).
 *
 * The stars are decorative: one label carries the value for assistive tech, so
 * a screen reader hears "Priority 2 of 3" rather than three icon names.
 */
export function PriorityStars({
  value,
  className,
}: {
  value: number | null;
  className?: string;
}) {
  if (value == null) {
    return (
      <span className={cn("text-ink-3", className)} aria-label="Unrated">
        —
      </span>
    );
  }
  return (
    <span
      className={cn("inline-flex items-center gap-0.5", className)}
      aria-label={`Priority ${value} of 3`}
      title={`Priority ${value} of 3`}
    >
      {[1, 2, 3].map((n) => (
        <Star
          key={n}
          aria-hidden
          className={cn("h-3 w-3", n <= value ? "text-warn fill-current" : "text-ink-3")}
        />
      ))}
    </span>
  );
}
