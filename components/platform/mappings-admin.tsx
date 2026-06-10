import { listAllMappings, type MappingRow } from "@/db/queries/platforms";
import { ALL_PLATFORMS, PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { MappingAddForm } from "@/components/platform/mapping-add-form";
import { MappingRemoveButton } from "@/components/platform/mapping-remove-button";
import { FIELD_LIST, type InternalField } from "@/csv/platforms/types";

/**
 * CSV column-mapping section — the body of the former /admin/platforms page,
 * now hosted inside the merged Catalog tab.
 */
export async function MappingsAdmin() {
  const rows = await listAllMappings();

  return (
    <div className="space-y-8">
      <p className="text-ink-2 text-sm max-w-2xl">
        For each platform, list the column headers your export uses for each
        field. On upload, headers are matched case-insensitively and the first
        match wins. Add one when an export uses a header that isn&apos;t
        recognized yet.
      </p>

      {ALL_PLATFORMS.map((platform) => {
        const platformRows = rows.filter((r) => r.platform === platform);
        const byField = groupByField(platformRows);
        return (
          <section key={platform} className="space-y-3">
            <div className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-sm"
                style={{ background: PLATFORM_COLOR[platform] }}
              />
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
                  <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink-3 border-b border-line">
                    <th className="font-medium px-3 py-2 w-48">Internal field</th>
                    <th className="font-medium px-3 py-2">Header candidates</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {FIELD_LIST.map((f) => (
                    <tr key={f.key} className="align-top">
                      <td className="px-3 py-2.5">
                        <div className="text-ink">{f.label}</div>
                        <div className="text-[10px] uppercase tracking-[0.14em] text-ink-3">
                          {f.required ? "required" : "optional"}
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
                  ))}
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
