import { PLATFORM_COLOR } from "@/lib/palette";
import { cn } from "@/lib/utils";

type PlatformKey = keyof typeof PLATFORM_COLOR;

const isPlatformKey = (p: string): p is PlatformKey => Object.hasOwn(PLATFORM_COLOR, p);

const SIZE: Record<"sm" | "md", string> = {
  sm: "w-1.5 h-1.5",
  md: "w-2 h-2",
};

/**
 * The canonical platform swatch — a rounded dot filled with the platform's
 * theme-aware color (lib/palette). Replaces ~a dozen hand-rolled inline
 * `<span style={{ background: PLATFORM_COLOR[p] }}>` spans that had drifted in
 * size/shape. Default is a `md` circle; pass `size="sm"` for dense chips.
 *
 * Accepts any string: Budget keys platforms as plain strings on purpose (a
 * stored plan snapshot may name a platform that has since been retired), so a
 * key that isn't a current platform renders a NEUTRAL dot rather than being
 * cast to one (W3-8 removed six `as never` casts that did exactly that).
 */
export function PlatformDot({
  platform,
  size = "md",
  className,
}: {
  platform: PlatformKey | (string & {});
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      className={cn("inline-block rounded-full shrink-0", SIZE[size], className)}
      style={{ background: isPlatformKey(platform) ? PLATFORM_COLOR[platform] : "var(--ink-3)" }}
      aria-hidden
    />
  );
}
