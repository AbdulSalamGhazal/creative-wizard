import {
  listAllMappings,
  platformRecordCounts,
} from "@/db/queries/platforms";
import { ALL_PLATFORMS, PLATFORM_LABEL } from "@/lib/palette";
import { PlatformDot } from "@/components/ui/platform-dot";
import { int } from "@/lib/format";
import {
  FIELD_META,
  INTERNAL_FIELDS,
  isFieldUnavailableOn,
  type InternalField,
  type Platform,
} from "@/csv/platforms/types";

// Derived from the single field registry (csv/platforms/types), PER PLATFORM:
// a field the platform can't report at all (google has no landing-page views,
// cart/payment events or video funnel) is not a gap in its mapping, so it
// counts on neither side. Required fields gate the "mapping ready" badge;
// optional ones still count toward the "all fields" total but don't block it.
const fieldsFor = (p: Platform) =>
  INTERNAL_FIELDS.filter((f) => !isFieldUnavailableOn(f, p));
const requiredFieldsFor = (p: Platform) =>
  fieldsFor(p).filter((f) => FIELD_META[f].required);

/**
 * Platform readiness — the supported ad channels (a fixed set: adding a new
 * one is a code-level change) with each platform's CSV-mapping readiness and
 * how much data it currently holds.
 *
 * This was its own Configuration tab until the 2026-09 IA pass; it is now the
 * header section of the CSV-mapping surface on the Uploads page, directly
 * above the per-platform header editors it summarises. (The old "Configure CSV
 * mapping" link went with it — it would now point at the same page.)
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
        A fixed set — adding a network is a code change, not a setting.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {ALL_PLATFORMS.map((p) => {
          const mapped = mappedByPlatform.get(p) ?? new Set<InternalField>();
          const requiredFields = requiredFieldsFor(p);
          const allFields = fieldsFor(p);
          const requiredMapped = requiredFields.filter((f) => mapped.has(f)).length;
          const totalMapped = allFields.filter((f) => mapped.has(f)).length;
          const ready = requiredMapped === requiredFields.length;
          const recordCount = records[p] ?? 0;

          return (
            <div
              key={p}
              className="rounded-lg border border-line bg-surface p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <PlatformDot platform={p} />
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
                  <div className="text-eyebrow text-ink-3">
                    Required fields
                  </div>
                  <div className="text-ink num mt-0.5">
                    {requiredMapped}/{requiredFields.length}
                  </div>
                </div>
                <div>
                  <div className="text-eyebrow text-ink-3">
                    All fields
                  </div>
                  <div className="text-ink num mt-0.5">
                    {totalMapped}/{allFields.length}
                  </div>
                </div>
                <div>
                  <div className="text-eyebrow text-ink-3">
                    Performance rows
                  </div>
                  <div className="text-ink num mt-0.5">{int(recordCount)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
