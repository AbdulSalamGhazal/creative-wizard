import { PLATFORM_COLOR } from "@/lib/palette";
import { cn } from "@/lib/utils";

type PlatformKey = keyof typeof PLATFORM_COLOR;

const SIZE: Record<"sm" | "md", string> = {
  sm: "w-1.5 h-1.5",
  md: "w-2 h-2",
};

/**
 * The canonical platform swatch — a rounded dot filled with the platform's
 * theme-aware color (lib/palette). Replaces ~a dozen hand-rolled inline
 * `<span style={{ background: PLATFORM_COLOR[p] }}>` spans that had drifted in
 * size/shape. Default is a `md` circle; pass `size="sm"` for dense chips.
 */
export function PlatformDot({
  platform,
  size = "md",
  className,
}: {
  platform: PlatformKey;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      className={cn("inline-block rounded-full shrink-0", SIZE[size], className)}
      style={{ background: PLATFORM_COLOR[platform] }}
      aria-hidden
    />
  );
}
