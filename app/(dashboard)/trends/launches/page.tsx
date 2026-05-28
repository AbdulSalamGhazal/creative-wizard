import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { launchReport } from "@/db/queries/trends";
import { LaunchReport } from "@/components/trends/launch-report";

export const dynamic = "force-dynamic";

export default async function TrendsLaunchesPage() {
  const { rows, cohorts } = await launchReport();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/trends"
          className="inline-flex items-center gap-1 text-[11px] text-ink-3 hover:text-ink transition-colors mb-2"
        >
          <ArrowLeft className="w-3 h-3" />
          Trends
        </Link>
        <h1 className="font-display text-4xl tracking-tight">Launches</h1>
        <p className="text-ink-2 text-sm mt-1">
          Each creative&apos;s first-7 and first-30 day performance, anchored to
          its own launch date — so launches from different months compare
          apples-to-apples. No global date filter here; the windows are
          relative to each launch.
        </p>
      </div>

      <LaunchReport rows={rows} cohorts={cohorts} />
    </div>
  );
}
