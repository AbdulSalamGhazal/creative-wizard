"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Dashboard route error boundary. Catches unexpected render/data errors in any
 * dashboard page and shows a recoverable fallback instead of a raw stack.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard error:", error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <div className="text-[11px] uppercase tracking-[0.18em] text-ink-3">
          Error
        </div>
        <h1 className="font-display text-3xl tracking-tight mt-1">
          Something went wrong
        </h1>
        <p className="text-ink-2 text-sm mt-2">
          We hit an unexpected error loading this page. You can try again, or
          head back to the overview.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button onClick={reset}>Try again</Button>
          <Button variant="ghost" asChild>
            <Link href="/">Go to Overview</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
