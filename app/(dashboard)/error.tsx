"use client";

import { useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { looksLikeDbError } from "@/lib/error-copy";

/**
 * Dashboard route error boundary. Catches unexpected render/data errors in any
 * dashboard page and shows a recoverable fallback instead of a raw stack.
 *
 * "Try again" REFETCHES before it re-renders. Every page here is a server
 * component, so the error arrived inside the RSC payload — `reset()` alone
 * re-renders that same cached payload and lands straight back on this screen
 * (the database blip below is exactly the case it can't recover). Refresh in
 * the same transition as the reset, so the retry renders fresh server data.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();
  const retry = () =>
    startRetry(() => {
      router.refresh();
      reset();
    });

  useEffect(() => {
    // Surfaces in the browser console and (for server-thrown errors) in Vercel's
    // function logs — production failures are visible without a third-party tool.
    console.error("Dashboard error:", error);
  }, [error]);

  // A reachability/connection failure (e.g. the database being briefly down)
  // gets calmer, recoverable copy than a genuine bug.
  // One heuristic with the global boundary (lib/error-copy, R-039).
  const looksLikeDb = looksLikeDbError(error?.message);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <div className="text-label text-ink-3">
          {looksLikeDb ? "Temporarily unavailable" : "Error"}
        </div>
        <h1 className="font-display text-4xl tracking-tight mt-1">
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
          <Button onClick={retry} disabled={retrying}>
            {retrying && <Loader2 className="w-4 h-4 animate-spin" />}
            Try again
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/">Go to Dashboard</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
