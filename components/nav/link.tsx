"use client";

import NextLink from "next/link";
import type { ComponentProps } from "react";
import { withBrand } from "@/lib/brand-path";
import { useBrandSlug } from "@/lib/brand-nav";

/**
 * `next/link`, put under this tab's brand (2026-11, lib/brand-path.ts). An
 * app path (`/library`) becomes `/urjwan/library`; anything else — another
 * brand's link, an API or auth path, an external URL — passes untouched.
 * Import it in place of `next/link` (`app/brand-nav.test.ts` insists).
 */
export default function Link({ href, ...rest }: ComponentProps<typeof NextLink>) {
  const slug = useBrandSlug();
  const branded =
    typeof href === "string"
      ? withBrand(slug, href)
      : href.pathname
        ? { ...href, pathname: withBrand(slug, href.pathname) }
        : href;
  return <NextLink href={branded} {...rest} />;
}
