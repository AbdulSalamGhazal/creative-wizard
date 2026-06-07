import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-ink px-6">
      <div className="text-center max-w-md">
        <div className="text-[11px] uppercase tracking-[0.18em] text-ink-3">
          404
        </div>
        <h1 className="font-display text-4xl tracking-tight mt-1">
          Page not found
        </h1>
        <p className="text-ink-2 text-sm mt-2">
          That page doesn&apos;t exist or may have moved.
        </p>
        <div className="mt-6">
          <Button asChild>
            <Link href="/">Back to Dashboard</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
