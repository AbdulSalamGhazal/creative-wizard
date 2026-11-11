import { LockKeyhole } from "lucide-react";
import Link from "@/components/nav/link";
import { BrandMark } from "@/components/account/brand-mark";
import { switchTarget } from "@/lib/brand-path";
import type { BrandStyle } from "@/lib/brand-style";

/**
 * Full-page state for a URL that names a brand this person can't open — one
 * they aren't a member of, or no brand at all (2026-11, the brand is in the
 * URL). Both read the same, so the page never confirms that a brand exists.
 * Rendered by the dashboard layout BEFORE any tenant query runs. Each of
 * their own brands is offered at the same page the link was for.
 */
export function BrandRefused({
  slug,
  appPath,
  search,
  brands,
}: {
  slug: string;
  appPath: string;
  search: string;
  brands: (BrandStyle & { slug: string })[];
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-8 text-center">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-ink-2">
          <LockKeyhole className="h-5 w-5" />
        </div>
        <h1 className="text-lg font-medium text-ink">You don&apos;t have access to this brand</h1>
        <p className="mt-2 text-sm text-ink-2">
          This link is for <span className="font-medium text-ink">“{slug}”</span>, which isn&apos;t one
          of your brands. Open the same page in one of yours:
        </p>
        <ul className="mt-6 space-y-2 text-left">
          {brands.map((b) => (
            <li key={b.id}>
              <Link
                href={switchTarget(b.slug, appPath, search).href}
                className="flex items-center gap-3 rounded-md border border-line px-3 py-2.5 text-sm text-ink transition hover:bg-surface-2"
              >
                <BrandMark brand={b} size="lg" />
                <span className="truncate">{b.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
