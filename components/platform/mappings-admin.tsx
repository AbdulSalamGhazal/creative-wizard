import { listAllMappings, type MappingRow } from "@/db/queries/platforms";
import { ALL_PLATFORMS, PLATFORM_LABEL } from "@/lib/palette";
import { PlatformDot } from "@/components/ui/platform-dot";
import { MappingAddForm } from "@/components/platform/mapping-add-form";
import { MappingRemoveButton } from "@/components/platform/mapping-remove-button";
import {
  FIELD_LIST,
  isFieldUnavailableOn,
  type InternalField,
} from "@/csv/platforms/types";
import { PlatformsAdmin } from "@/components/platform/platforms-admin";

/**
 * The CSV-mapping surface: per-platform readiness up top (the former separate
 * "Platforms" tab, merged in during the 2026-09 IA pass) followed by the
 * per-platform header editors it summarises. Lives on the Uploads page —
 * mapping is upload configuration, so it sits with the uploads it governs.
 */
export async function MappingsAdmin() {
  const rows = await listAllMappings();

  return (
    <div className="space-y-8">
      <PlatformsAdmin />

      {ALL_PLATFORMS.map((platform) => {
        const platformRows = rows.filter((r) => r.platform === platform);
        const byField = groupByField(platformRows);
        return (
          <section key={platform} className="space-y-3">
            <div className="flex items-center gap-2">
              <PlatformDot platform={platform} />
              <h3 className="font-display text-xl tracking-tight">
                {PLATFORM_LABEL[platform]}
              </h3>
            </div>

            <div className="rounded-lg border border-line bg-surface p-4">
              <MappingAddForm platform={platform} />
            </div>

            <div className="rounded-lg border border-line bg-surface overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-label text-ink-3 border-b border-line">
                    <th className="font-medium px-3 py-2 w-48">Internal field</th>
                    <th className="font-medium px-3 py-2">Header candidates</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {FIELD_LIST.map((f) => {
                    // A field this platform can't report is shown, but greyed
                    // and unmappable: a header mapped here would be ignored
                    // (the pipeline stores NULL for it by declaration).
                    const unavailable = isFieldUnavailableOn(f.key, platform);
                    return (
                    <tr key={f.key} className="align-top">
                      <td className="px-3 py-2.5">
                        <div className={unavailable ? "text-ink-3" : "text-ink"}>
                          {f.label}
                        </div>
                        <div className="text-eyebrow text-ink-3">
                          {unavailable
                            ? `not reported by ${PLATFORM_LABEL[platform]}`
                            : f.required
                              ? "required"
                              : "optional"}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {byField[f.key]?.length ? (
                            byField[f.key]!.map((r) => (
                              <span
                                key={r.id}
                                className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded text-[11px] bg-surface-2 border border-line text-ink-2"
                              >
                                <span className="font-mono text-ink">
                                  {r.headerName}
                                </span>
                                <MappingRemoveButton id={r.id} />
                              </span>
                            ))
                          ) : unavailable ? (
                            <span className="text-[11px] text-ink-3 italic">
                              {PLATFORM_LABEL[platform]} exports don&apos;t carry
                              this metric — rows are stored as{" "}
                              <span className="font-mono">NULL</span>, never 0,
                              and it&apos;s left out of blended rates.
                            </span>
                          ) : (
                            <span className="text-[11px] text-ink-3 italic">
                              No header names mapped yet — uploads won&apos;t
                              recognize the{" "}
                              <code className="font-mono">{f.label}</code> column
                              until you add one.
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      <p className="text-[11px] text-ink-3">
        Header matching is case-insensitive and whitespace-trimmed. Adding a
        new candidate is non-destructive — existing uploads aren&apos;t
        affected, only future ones. Removing the last candidate for a required
        field will make every upload for that platform fail until you add one.
      </p>
    </div>
  );
}

function groupByField(
  rows: MappingRow[],
): Partial<Record<InternalField, MappingRow[]>> {
  const out: Partial<Record<InternalField, MappingRow[]>> = {};
  for (const r of rows) {
    (out[r.internalField] ??= []).push(r);
  }
  return out;
}
