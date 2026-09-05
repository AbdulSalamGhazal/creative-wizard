"use client";

import { useCallback, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { useNavTransition } from "@/lib/nav-progress";
import { navItemHref, type NavItem } from "@/components/layout/nav-items";

type LinkableItem = Pick<NavItem, "href" | "group">;

export interface NavLinkProps {
  href: string;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * Link props for a nav item whose destination depends on the CURRENT url —
 * today that's the Budget section, whose links carry `?month=`.
 *
 * The rendered href alone can't be trusted for those: it's derived from
 * `useSearchParams()`, which reads empty while the Suspense boundary around the
 * nav is still on its fallback, so a click landing in that window would drop
 * the month and bounce the user to the current month. Rather than depend on
 * hydration timing, the CLICK is the source of truth — a plain left-click
 * re-derives the destination from `window.location` (always current, no React
 * state involved) and pushes that. The href stays as progressive enhancement:
 * correct in the server HTML, correct once hydrated, and the only thing a
 * modified click (cmd/ctrl/middle → new tab) or a pre-hydration click can use.
 *
 * Non-Budget items get a plain href and no handler — normal `<Link>` behavior.
 */
export function useNavLinkProps(
  pathname: string,
  search: { get(name: string): string | null } | null,
): (item: LinkableItem) => NavLinkProps {
  const router = useRouter();
  const [, startNav] = useNavTransition();

  return useCallback(
    (item: LinkableItem): NavLinkProps => {
      const href = navItemHref(item, pathname, search);
      // Only month-carrying links need click-time resolution.
      if (item.group !== "budget") return { href };

      return {
        href,
        onClick: (e: MouseEvent<HTMLAnchorElement>) => {
          // Let the browser own modified / non-primary clicks (open in a new
          // tab or window) — those follow the href, untouched.
          if (
            e.defaultPrevented ||
            e.button !== 0 ||
            e.metaKey ||
            e.ctrlKey ||
            e.shiftKey ||
            e.altKey
          ) {
            return;
          }
          const target = navItemHref(
            item,
            window.location.pathname,
            new URLSearchParams(window.location.search),
          );
          e.preventDefault();
          startNav(() => router.push(target));
        },
      };
    },
    [pathname, search, router, startNav],
  );
}
