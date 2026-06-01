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
    // Surfaces in the browser console and (for server-thrown errors) in Vercel's
    // function logs — production failures are visible without a third-party tool.
    console.error("Dashboard error:", error);
  }, [error]);

  // A reachability/connection failure (e.g. the database being briefly down)
  // gets calmer, recoverable copy than a genuine bug.
  const looksLikeDb = /connect|timeout|econnrefused|database|terminat|pool/i.test(
    error?.message ?? "",
  );

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <div className="text-[11px] uppercase tracking-[0.18em] text-ink-3">
          {looksLikeDb ? "Temporarily unavailable" : "Error"}
        </div>
        <h1 className="font-display text-3xl tracking-tight mt-1">
          {looksLikeDb ? "We couldn’t reach the data" : "Something went wrong"}
        </h1>
        <p className="text-ink-2 text-sm mt-2">
          {looksLikeDb
            ? "The database didn’t respond just now — this is usually a brief blip. Give it a moment, then try again."
            : "We hit an unexpected error loading this page. You can try again, or head back to the overview."}
        </p>
        {error?.digest && (
          <p className="text-[11px] text-ink-3 font-mono mt-2">ref: {error.digest}</p>
        )}
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
