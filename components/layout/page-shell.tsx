import { Suspense, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const WIDTHS = {
  /** Full-width dashboards and tables. */
  full: "",
  /** Admin config pages. */
  admin: "max-w-4xl mx-auto",
  /** Single entity create/edit forms. */
  form: "max-w-2xl mx-auto",
  /** Multi-step import / upload flows. */
  import: "max-w-3xl mx-auto",
} as const;

interface PageShellProps {
  children: ReactNode;
  /** Content max-width. Default full; admin=4xl, form=2xl, import=3xl. */
  width?: keyof typeof WIDTHS;
  /**
   * A full-bleed sticky FilterStrip rendered flush to the top edge, above the
   * header. The shell owns the `-mx-6 -mt-6` full-bleed treatment (and the
   * Suspense boundary FilterStrip needs for `useSearchParams`) so pages stop
   * hand-rolling it.
   */
  filterStrip?: ReactNode;
}

/**
 * The one page shell: `space-y-6` vertical rhythm + a width lane + an optional
 * full-bleed filter-strip slot. Replaces the per-page space-y-4/6/10 drift and
 * the copy-pasted `-mx-6 -mt-6 mb-2` full-bleed hack.
 */
export function PageShell({ children, width = "full", filterStrip }: PageShellProps) {
  return (
    <div className={cn("space-y-6", WIDTHS[width])}>
      {filterStrip != null && (
        <Suspense
          fallback={
            <div className="-mx-6 px-6 h-12 border-b border-line bg-background/95 backdrop-blur" />
          }
        >
          <div className="-mx-6 -mt-6 mb-2">{filterStrip}</div>
        </Suspense>
      )}
      {children}
    </div>
  );
}
