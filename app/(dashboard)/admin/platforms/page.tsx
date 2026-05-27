import { requireAdmin } from "@/lib/auth";
import {
  listAllMappings,
  type MappingRow,
} from "@/db/queries/platforms";
import { ALL_PLATFORMS, PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { MappingAddForm } from "@/components/platform/mapping-add-form";
import { MappingRemoveButton } from "@/components/platform/mapping-remove-button";
import type { InternalField } from "@/csv/platforms/types";

export const dynamic = "force-dynamic";

const FIELDS: Array<{ value: InternalField; label: string; required: boolean }> = [
  { value: "creative_name", label: "Creative name", required: true },
  { value: "date", label: "Date", required: true },
  { value: "spend", label: "Spend", required: true },
  { value: "impressions", label: "Impressions", required: true },
  { value: "clicks", label: "Clicks", required: true },
  { value: "conversions", label: "Conversions", required: false },
  { value: "conversion_value", label: "Conversion value", required: false },
  { value: "video_views_3s", label: "Video views 3s", required: false },
  { value: "video_views_15s", label: "Video views 15s", required: false },
];

export default async function PlatformsAdminPage() {
  await requireAdmin();
  const rows = await listAllMappings();

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink-3 mb-1">
          Admin
        </div>
        <h1 className="font-display text-4xl tracking-tight">
          CSV column mapping
        </h1>
        <p className="text-ink-2 text-sm mt-1 max-w-2xl">
          For each platform, list the header strings your CSV export uses for
          each internal field. The validation pipeline matches headers
          case-insensitively and picks the first one that hits. Add a candidate
          when an export uses a header that isn&apos;t recognized yet.
        </p>
      </div>

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
              <h2 className="font-display text-2xl tracking-tight">
                {PLATFORM_LABEL[platform]}
              </h2>
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
                  {FIELDS.map((f) => (
                    <tr key={f.value} className="align-top">
                      <td className="px-3 py-2.5">
                        <div className="text-ink">{f.label}</div>
                        <div className="text-[10px] uppercase tracking-[0.14em] text-ink-3">
                          {f.required ? "required" : "optional"}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {byField[f.value]?.length ? (
                            byField[f.value]!.map((r) => (
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
                              No candidates yet — uploads will hit E010 for{" "}
                              <code className="font-mono">{f.label}</code>.
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

function groupByField(rows: MappingRow[]): Partial<Record<InternalField, MappingRow[]>> {
  const out: Partial<Record<InternalField, MappingRow[]>> = {};
  for (const r of rows) {
    (out[r.internalField] ??= []).push(r);
  }
  return out;
}
