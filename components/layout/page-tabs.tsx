import Link from "next/link";

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
 */
export function PageTabs({
  tabs,
  active,
}: {
  tabs: readonly PageTab[];
  active: string;
}) {
  if (tabs.length < 2) return null;
  return (
    <div className="flex items-center gap-1 border-b border-line">
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            scroll={false}
            className={
              "relative px-3 py-2 text-sm transition-colors -mb-px border-b-2 " +
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
  );
}
