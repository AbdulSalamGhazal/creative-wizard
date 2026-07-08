import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * WIZARD brand logomark — the full-colour `public/logo.png` (transparent
 * background, trimmed to the artwork; intrinsic 385×212), shown at its original
 * colours. Callers size it by HEIGHT (`h-10 w-auto` in the top bar, `h-16` on
 * sign-in); `object-contain` keeps the aspect so it never distorts.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <Image
      src="/logo.png"
      alt=""
      width={385}
      height={212}
      priority
      unoptimized
      className={cn("object-contain", className)}
    />
  );
}
