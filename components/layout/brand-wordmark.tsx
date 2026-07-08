import { cn } from "@/lib/utils";

/**
 * "WIZARD" wordmark — a single-ink, extrabold sans lockup (black in light
 * themes, white in dark, via `text-ink`) with slightly expanded tracking.
 * Sized by the caller via `className`.
 */
export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "font-sans font-extrabold uppercase tracking-[0.18em] text-ink select-none",
        className,
      )}
    >
      WIZARD
    </span>
  );
}
