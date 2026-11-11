"use client";

import { useState } from "react";
import { brandColor, brandInitial } from "@/lib/brand-style";
import { cn } from "@/lib/utils";

/**
 * THE brand picture (2026-11): the switcher pill, its list, and the Brands
 * editor. The brand's initial on its colour is ALWAYS drawn; an uploaded logo
 * is layered over it on a white tile (a logo is designed for a light ground,
 * and transparent PNGs vanish on a dark one). A logo that fails to load drops
 * back to the initial — the UserAvatar rule, never a broken image.
 *
 * Decorative (`aria-hidden`): it always sits beside the brand's name, or
 * inside a control that carries the label.
 */

export type BrandMarkSize = "sm" | "md" | "lg" | "xl";

const SIZE: Record<BrandMarkSize, string> = {
  /** 16 px — a switcher list row. */
  sm: "h-4 w-4 text-[9px]",
  /** 20 px — the top-bar pill. */
  md: "h-5 w-5 text-[10px]",
  /** 28 px — a Brands table row. */
  lg: "h-7 w-7 text-xs",
  /** 48 px — the style editor's preview. */
  xl: "h-12 w-12 text-lg",
};

export function BrandMark({
  brand,
  size = "md",
  className,
}: {
  brand: { id: string; name: string; color: string | null; logoUrl: string | null };
  size?: BrandMarkSize;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = brand.logoUrl;
  const showLogo = Boolean(src) && src !== failedSrc;
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-sm font-semibold leading-none",
        // The swatches are series tokens: light on the dark themes, dark on
        // the light ones — the avatar's ink rule follows that.
        "text-white dark:text-background",
        SIZE[size],
        className,
      )}
      style={{ background: brandColor(brand) }}
    >
      {brandInitial(brand.name)}
      {showLogo && (
        // eslint-disable-next-line @next/next/no-img-element -- a ~128 px WebP; the optimizer would add a round trip for nothing
        <img
          src={src ?? undefined}
          alt=""
          decoding="async"
          draggable={false}
          onError={() => setFailedSrc(src)}
          className="absolute inset-0 h-full w-full bg-white object-contain p-px"
        />
      )}
    </span>
  );
}
