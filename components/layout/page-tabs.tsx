"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useNavTransition } from "@/lib/nav-progress";

export interface PageTab {
  key: string;
  label: string;
  href: string;
}

/**
 * The one in-page tab row. Extracted from the Configuration admin (which grew
 * it first) so the surfaces that now host relocated admin sections — Library,
 * the ads Uploads page, Store uploads — all read identically instead of each
 * re-rolling the underline treatment.
 *
 * Tabs are permission-filtered by the CALLER (it holds the session), so this
 * is presentational. A single remaining tab renders nothing: a one-item tab
 * row is dead UI, and the page then just shows that tab's content — which is
 * exactly what a viewer with no admin permissions should see.
 *
 * A row wider than its frame (the Library's four tabs at 375px) SCROLLS
 * sideways instead of wrapping a label onto two lines; the active tab is kept
 * in view. The border lives on the inner row, so each tab's `-mb-px`
 * underline still lands ON the line without growing the scroll box.
 */
export function PageTabs({
  tabs,
  active,
}: {
  tabs: readonly PageTab[];
  active: string;
}) {
  const router = useRouter();
  const [, startNav] = useNavTransition();
  const activeRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);
  if (tabs.length < 2) return null;
  return (
    <div className="overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex w-full min-w-max items-center gap-1 border-b border-line">
        {tabs.map((t) => {
          const isActive = t.key === active;
          return (
            <Link
              key={t.key}
              ref={isActive ? activeRef : undefined}
              aria-current={isActive ? "page" : undefined}
              href={t.href}
              scroll={false}
              // Through the nav transition so the progress bar shows: a tab
              // switch re-renders a whole server page and otherwise looks inert.
              onClick={(e) => {
                if (
                  e.defaultPrevented ||
                  e.metaKey ||
                  e.ctrlKey ||
                  e.shiftKey ||
                  e.altKey ||
                  e.button !== 0
                ) {
                  return;
                }
                e.preventDefault();
                startNav(() => router.push(t.href, { scroll: false }));
              }}
              className={
                "relative shrink-0 whitespace-nowrap px-3 py-2 text-sm transition-colors -mb-px border-b-2 " +
                (isActive
                  ? "border-brand text-ink"
                  : "border-transparent text-ink-2 hover:text-ink")
              }
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
