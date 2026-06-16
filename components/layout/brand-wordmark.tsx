import { cn } from "@/lib/utils";

/**
 * "WIZARD" wordmark — the display font with a vibrant left-to-right gradient
 * fill (matching the logomark's rainbow). Sized by the caller via `className`.
 */
export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "font-display font-semibold uppercase tracking-[0.12em] bg-clip-text text-transparent select-none",
        className,
      )}
      style={{
        backgroundImage:
          "linear-gradient(95deg,#3b82f6 0%,#06b6d4 22%,#22c55e 44%,#eab308 60%,#f97316 78%,#ec4899 100%)",
      }}
    >
      WIZARD
    </span>
  );
}
