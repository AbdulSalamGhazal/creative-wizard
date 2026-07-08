import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * WIZARD brand logomark — the full-colour `public/logo.png` (transparent
 * background), shown at its original colours. Fills the box the caller sizes
 * via `className` (e.g. `w-10 h-10` in the top bar, `w-14 h-14` on sign-in),
 * scaled to fit with `object-contain` so the artwork never distorts.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <Image
      src="/logo.png"
      alt=""
      width={500}
      height={500}
      priority
      unoptimized
      className={cn("object-contain", className)}
    />
  );
}
