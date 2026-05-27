import Link from "next/link";
import { ALL_PLATFORMS, PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { ArrowRight } from "lucide-react";

export default function PlatformsIndex() {
  return (
    <div className="space-y-6">
      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink-3 mb-1">
          Platforms
        </div>
        <h1 className="font-display text-4xl tracking-tight">By platform</h1>
        <p className="text-ink-2 text-sm mt-1">
          Drill into a single channel. Filters apply across the platform&apos;s
          views.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {ALL_PLATFORMS.map((p) => (
          <Link
            key={p}
            href={`/platforms/${p}`}
            className="group rounded-lg border border-line bg-surface px-5 py-5 hover:-translate-y-0.5 hover:border-line-2 transition-all"
          >
            <div
              className="w-8 h-8 rounded-md mb-3 flex items-center justify-center"
              style={{ background: `${PLATFORM_COLOR[p]}1a`, border: `1px solid ${PLATFORM_COLOR[p]}40` }}
            >
              <span
                className="w-2 h-2 rounded-sm"
                style={{ background: PLATFORM_COLOR[p] }}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="font-display text-2xl tracking-tight">
                {PLATFORM_LABEL[p]}
              </div>
              <ArrowRight className="w-4 h-4 text-ink-3 group-hover:text-ink transition-colors" />
            </div>
            <div className="text-[11px] text-ink-3 mt-1">
              Spend, top creatives, mix
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
