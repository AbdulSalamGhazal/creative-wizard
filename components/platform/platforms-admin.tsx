import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  listAllMappings,
  platformRecordCounts,
} from "@/db/queries/platforms";
import { ALL_PLATFORMS, PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { int } from "@/lib/format";
import type { InternalField } from "@/csv/platforms/types";

// Required fields gate "mapping ready"; optional ones (the commerce funnel
// events) count toward "all fields" but don't block readiness.
const REQUIRED_FIELDS: InternalField[] = [
  "creative_name",
  "campaign_name",
  "adset_name",
  "date",
  "spend",
  "impressions",
  "clicks",
  "conversions",
  "conversion_value",
  "landing_page_views",
  "video_views_2s",
  "video_views_25",
  "video_views_50",
  "video_views_75",
  "video_views_100",
];
const OPTIONAL_FIELDS: InternalField[] = ["add_to_cart", "add_payment"];
const ALL_FIELDS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];

/**
 * Platforms overview — the supported ad channels (a fixed set: adding a new
 * one is a code-level change) with each platform's CSV-mapping readiness and
 * how much data it currently holds. Drill into CSV mapping to edit headers.
 */
export async function PlatformsAdmin() {
  const [mappings, records] = await Promise.all([
    listAllMappings(),
    platformRecordCounts(),
  ]);

  // Which internal fields have ≥1 header candidate, per platform.
  const mappedByPlatform = new Map<string, Set<InternalField>>();
  for (const m of mappings) {
    const set = mappedByPlatform.get(m.platform) ?? new Set<InternalField>();
    set.add(m.internalField);
    mappedByPlatform.set(m.platform, set);
  }

  return (
    <div className="space-y-4">
      <p className="text-ink-2 text-sm">
        The supported ad channels. Platforms are a fixed set — adding a new
        network is a code change, not a setting. Each card shows its CSV
        column-mapping readiness and how many performance rows it holds.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {ALL_PLATFORMS.map((p) => {
          const mapped = mappedByPlatform.get(p) ?? new Set<InternalField>();
          const requiredMapped = REQUIRED_FIELDS.filter((f) => mapped.has(f)).length;
          const totalMapped = ALL_FIELDS.filter((f) => mapped.has(f)).length;
          const ready = requiredMapped === REQUIRED_FIELDS.length;
          const recordCount = records[p] ?? 0;

          return (
            <div
              key={p}
              className="rounded-lg border border-line bg-surface p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-sm"
                    style={{ background: PLATFORM_COLOR[p] }}
                  />
                  <span className="text-ink font-medium">{PLATFORM_LABEL[p]}</span>
                </div>
                <span
                  className={
                    "inline-flex items-center h-5 px-1.5 rounded text-[10px] border " +
                    (ready
                      ? "border-pos/40 text-pos bg-pos/10"
                      : "border-warn/40 text-warn bg-warn/10")
                  }
                >
                  {ready ? "Mapping ready" : "Mapping incomplete"}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em] text-ink-3">
                    Required fields
                  </div>
                  <div className="text-ink num mt-0.5">
                    {requiredMapped}/{REQUIRED_FIELDS.length}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em] text-ink-3">
                    All fields
                  </div>
                  <div className="text-ink num mt-0.5">
                    {totalMapped}/{ALL_FIELDS.length}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em] text-ink-3">
                    Performance rows
                  </div>
                  <div className="text-ink num mt-0.5">{int(recordCount)}</div>
                </div>
              </div>

              <Link
                href="/admin/catalog?tab=mapping"
                className="inline-flex items-center gap-1 text-[12px] text-ink-2 hover:text-brand transition-colors"
              >
                Configure CSV mapping
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
