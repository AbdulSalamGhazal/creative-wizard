import Link from "next/link";
import {
  ArrowRight,
  Hash,
  LineChart as LineChartIcon,
  Rocket,
  Shapes,
  Video,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { DeltaBadge } from "@/components/kpi/delta-badge";
import { kpisWithDelta } from "@/db/queries/performance";
import { defaultDateRange } from "@/lib/date-presets";
import { resolvePreferredRange } from "@/db/queries/user-prefs";
import { usd } from "@/lib/format";

export const dynamic = "force-dynamic";

const TRAILING_DAYS_DEFAULT = 30;

/**
 * Trends landing — a launcher for the analytical sub-views. Each card
 * stages one lens; clicking drills into its dedicated route.
 *
 * The Over-time card hydrates a real teaser delta so the landing isn't a
 * dead-end. The other three lenses are scaffolded with "Coming soon"
 * placeholders so the IA is visible end-to-end while we build them out.
 */
export default async function TrendsLandingPage() {
  const range = await resolvePreferredRange(
    undefined,
    undefined,
    defaultDateRange(TRAILING_DAYS_DEFAULT),
  );
  const k = await kpisWithDelta({ from: range.from, to: range.to });

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink-3 mb-1">
          Analytics
        </div>
        <h1 className="font-display text-4xl tracking-tight">Trends</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <LensCard
          href="/trends/over-time"
          icon={LineChartIcon}
          title="Changes"
          available
          teaser={
            <div className="flex items-baseline gap-3">
              <div className="font-display text-2xl text-ink num leading-none">
                {usd(k.current.spend)}
              </div>
              <DeltaBadge delta={k.delta.spend} />
              <span className="text-[11px] text-ink-3">last 30d spend</span>
            </div>
          }
        />
        <LensCard
          href="/trends/by-tag"
          icon={Hash}
          title="Tags"
          available
        />
        <LensCard
          href="/trends/by-type"
          icon={Shapes}
          title="Types"
          available
        />
        <LensCard
          href="/trends/launches"
          icon={Rocket}
          title="Launches"
          available
        />
        <LensCard
          href="/trends/video"
          icon={Video}
          title="Video diagnostics"
          available
        />
      </div>
    </div>
  );
}

function LensCard({
  href,
  icon: Icon,
  title,
  description,
  teaser,
  available = false,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  teaser?: React.ReactNode;
  available?: boolean;
}) {
  return (
    <Card className="bg-surface border-line p-5 group hover:border-brand/40 transition-colors">
      <Link href={href} className="block space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-surface-2 border border-line flex items-center justify-center text-ink-2 group-hover:text-brand transition-colors">
              <Icon className="w-4 h-4" />
            </div>
            <h2 className="text-base font-medium text-ink">{title}</h2>
          </div>
          {available ? (
            <ArrowRight className="w-4 h-4 text-ink-3 group-hover:text-brand transition-colors" />
          ) : (
            <span className="inline-flex items-center h-5 px-1.5 rounded text-[10px] border border-line text-ink-3 bg-surface-2">
              Coming soon
            </span>
          )}
        </div>
        {description && (
          <p className="text-ink-2 text-sm leading-relaxed">{description}</p>
        )}
        {teaser && (
          <div className="pt-2 border-t border-line">{teaser}</div>
        )}
      </Link>
    </Card>
  );
}
