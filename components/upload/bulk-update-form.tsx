"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Check, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dropzone } from "@/components/upload/dropzone";
import { ErrorReport } from "@/components/upload/error-report";
import { PlatformPicker, PLATFORMS } from "@/components/upload/platform-picker";
import { PLATFORM_LABEL } from "@/lib/palette";
import { int, usd } from "@/lib/format";
import type { ValidationError } from "@/csv/errors";

type Platform = (typeof PLATFORMS)[number]["value"];

const FIELD_META: Record<string, { label: string; money?: boolean }> = {
  spend: { label: "Spend", money: true },
  impressions: { label: "Impressions" },
  clicks: { label: "Clicks" },
  conversions: { label: "Conversions" },
  conversion_value: { label: "Conv. value", money: true },
  landing_page_views: { label: "LP views" },
  video_views_2s: { label: "2s views" },
  video_views_25: { label: "25% views" },
  video_views_50: { label: "50% views" },
  video_views_75: { label: "75% views" },
  video_views_100: { label: "100% views" },
};
const fieldLabel = (f: string) => FIELD_META[f]?.label ?? f;
const fmtVal = (f: string, v: number | null) =>
  v === null ? "—" : FIELD_META[f]?.money ? usd(v) : int(v);

interface Summary {
  rows: number;
  creatives: number;
  dateRange: { from: string; to: string } | null;
  updateColumns: string[];
  cellsChanged: number;
}
interface Change {
  field: string;
  old: number | null;
  next: number | null;
}
interface PreviewRow {
  creativeName: string;
  campaignName: string;
  date: string;
  changes: Change[];
}

type Stage =
  | { kind: "idle" }
  | { kind: "validating" }
  | { kind: "invalid"; errors: ValidationError[]; warnings: ValidationError[]; platform: Platform }
  | { kind: "valid"; token: string; summary: Summary; preview: PreviewRow[]; warnings: ValidationError[]; platform: Platform }
  | { kind: "committing"; token: string; platform: Platform }
  | { kind: "committed"; rowsUpdated: number; cellsChanged: number; platform: Platform }
  | { kind: "error"; message: string };

export function BulkUpdateForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });

  const reset = () => {
    setFile(null);
    setPlatform(null);
    setStage({ kind: "idle" });
  };

  const onValidate = async () => {
    if (!file || !platform) return;
    setStage({ kind: "validating" });
    const form = new FormData();
    form.set("platform", platform);
    form.set("file", file);

    let res: Response;
    try {
      res = await fetch("/api/uploads/bulk-update/validate", { method: "POST", body: form });
    } catch (err) {
      setStage({ kind: "error", message: `Network error: ${(err as Error).message}` });
      return;
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      setStage({ kind: "error", message: "Server returned a non-JSON response." });
      return;
    }

    if (res.status === 422 || res.status === 413) {
      const d = data as { errors?: ValidationError[]; warnings?: ValidationError[]; error?: string };
      setStage({
        kind: "invalid",
        errors: d.errors ?? [{ code: "E001", severity: "FATAL", message: d.error ?? "Validation failed." }],
        warnings: d.warnings ?? [],
        platform,
      });
      return;
    }
    if (!res.ok) {
      const d = data as { error?: string };
      setStage({ kind: "error", message: d.error ?? `Validate failed (HTTP ${res.status})` });
      return;
    }

    const ok = data as { token: string; summary: Summary; preview: PreviewRow[]; warnings: ValidationError[] };
    setStage({ kind: "valid", token: ok.token, summary: ok.summary, preview: ok.preview, warnings: ok.warnings, platform });
  };

  const onCommit = async () => {
    if (stage.kind !== "valid") return;
    const { token, platform: p } = stage;
    setStage({ kind: "committing", token, platform: p });

    let res: Response;
    try {
      res = await fetch("/api/uploads/bulk-update/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
    } catch (err) {
      setStage({ kind: "error", message: `Network error: ${(err as Error).message}` });
      return;
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      setStage({ kind: "error", message: "Server returned a non-JSON response." });
      return;
    }
    if (!res.ok) {
      const d = data as { error?: string };
      setStage({ kind: "error", message: d.error ?? `Commit failed (HTTP ${res.status})` });
      return;
    }
    const ok = data as { rowsUpdated: number; cellsChanged: number };
    setStage({ kind: "committed", rowsUpdated: ok.rowsUpdated, cellsChanged: ok.cellsChanged, platform: p });
    router.refresh();
  };

  if (stage.kind === "committed") {
    return (
      <div className="rounded-lg border border-pos/30 bg-pos/5 px-6 py-8 text-center">
        <div className="w-12 h-12 rounded-full bg-pos/15 border border-pos/30 mx-auto flex items-center justify-center">
          <Check className="w-5 h-5 text-pos" />
        </div>
        <h2 className="mt-4 font-display text-3xl tracking-tight">Update complete</h2>
        <p className="mt-2 text-ink-2 text-sm num">
          {stage.rowsUpdated} record{stage.rowsUpdated === 1 ? "" : "s"} updated ·{" "}
          {stage.cellsChanged} value{stage.cellsChanged === 1 ? "" : "s"} changed on{" "}
          <span className="text-ink">{PLATFORM_LABEL[stage.platform]}</span>.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button asChild>
            <Link href="/">View on Overview</Link>
          </Button>
          <Button variant="ghost" onClick={reset}>
            <RefreshCw className="w-3.5 h-3.5" />
            Update more
          </Button>
        </div>
      </div>
    );
  }

  const busy = stage.kind === "validating" || stage.kind === "committing";
  const canValidate = !!file && !!platform && !busy;

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <div className="text-sm text-ink">1. File</div>
        <Dropzone file={file} onFile={setFile} disabled={busy} />
        <p className="text-[11px] text-ink-3">
          Include the identity columns (creative name, campaign, adset, date)
          plus only the value columns you want to overwrite — e.g. just Spend.
        </p>
      </div>

      {file && (
        <div className="space-y-2">
          <div className="text-sm text-ink">2. Platform</div>
          <PlatformPicker value={platform} onChange={setPlatform} disabled={busy || stage.kind === "valid"} />
        </div>
      )}

      {stage.kind === "idle" && (
        <div className="flex items-center justify-end">
          <Button onClick={onValidate} disabled={!canValidate}>
            Validate
          </Button>
        </div>
      )}

      {stage.kind === "validating" && (
        <div className="rounded-lg border border-line bg-surface px-4 py-3 flex items-center gap-3">
          <Loader2 className="w-4 h-4 animate-spin text-brand" />
          <span className="text-sm text-ink-2">Matching rows against your data…</span>
        </div>
      )}

      {stage.kind === "invalid" && (
        <>
          <ErrorReport errors={stage.errors} warnings={stage.warnings} />
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={reset}>Start over</Button>
            <Button onClick={onValidate} disabled={!canValidate}>
              <RefreshCw className="w-3.5 h-3.5" />
              Try again
            </Button>
          </div>
        </>
      )}

      {stage.kind === "valid" && (
        <>
          <div className="rounded-lg border border-line bg-surface p-4 space-y-3">
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <Stat label="Records matched" value={int(stage.summary.rows)} />
              <Stat label="Values changing" value={int(stage.summary.cellsChanged)} />
              <Stat label="Creatives" value={int(stage.summary.creatives)} />
              {stage.summary.dateRange && (
                <Stat
                  label="Date range"
                  value={`${stage.summary.dateRange.from} → ${stage.summary.dateRange.to}`}
                />
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
              <span className="text-ink-3">Updating columns:</span>
              {stage.summary.updateColumns.map((c) => (
                <span key={c} className="inline-flex h-5 items-center px-1.5 rounded bg-surface-2 border border-line text-ink-2">
                  {fieldLabel(c)}
                </span>
              ))}
            </div>
            {stage.summary.cellsChanged === 0 && (
              <p className="text-[11px] text-warn">
                Every matched value already equals the file — applying changes nothing.
              </p>
            )}
          </div>

          <BulkUpdatePreview rows={stage.preview} total={stage.summary.rows} />

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={reset}>Cancel</Button>
            <Button onClick={onCommit}>
              Apply {stage.summary.rows} update{stage.summary.rows === 1 ? "" : "s"}
            </Button>
          </div>
        </>
      )}

      {stage.kind === "committing" && (
        <div className="rounded-lg border border-line bg-surface px-4 py-3 flex items-center gap-3">
          <Loader2 className="w-4 h-4 animate-spin text-brand" />
          <span className="text-sm text-ink-2">Applying updates…</span>
        </div>
      )}

      {stage.kind === "error" && (
        <div className="rounded-lg border border-neg/30 bg-neg/5 px-4 py-3 text-sm text-ink space-y-2">
          <div>{stage.message}</div>
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={reset}>Reset</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-ink-3">{label}</div>
      <div className="font-display text-2xl num text-ink leading-tight">{value}</div>
    </div>
  );
}

function BulkUpdatePreview({ rows, total }: { rows: PreviewRow[]; total: number }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-8 text-center text-ink-3 text-sm">
        No value changes to preview — every matched cell already equals the file.
      </div>
    );
  }
  return (
    <div className="max-h-[50vh] overflow-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm num">
        <thead className="sticky top-0 z-10 bg-surface">
          <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink-3 border-b border-line">
            <th className="font-medium px-3 py-2.5 bg-surface">Creative</th>
            <th className="font-medium px-3 py-2.5 bg-surface">Campaign</th>
            <th className="font-medium px-3 py-2.5 bg-surface">Date</th>
            <th className="font-medium px-3 py-2.5 bg-surface">Changes (old → new)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => (
            <tr key={`${r.creativeName}:${r.campaignName}:${r.date}:${i}`} className="align-top">
              <td className="px-3 py-2 font-mono text-[12px] text-ink-2 max-w-[14rem]">
                <span className="block truncate" title={r.creativeName}>{r.creativeName}</span>
              </td>
              <td className="px-3 py-2 text-[12px] text-ink-3 max-w-[16rem]">
                <span className="block truncate" title={r.campaignName}>{r.campaignName}</span>
              </td>
              <td className="px-3 py-2 text-ink-3 tabular-nums whitespace-nowrap">{r.date}</td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1.5">
                  {r.changes.map((c) => (
                    <span key={c.field} className="inline-flex items-center gap-1 text-[11px] rounded bg-surface-2 border border-line px-1.5 py-0.5">
                      <span className="text-ink-3">{fieldLabel(c.field)}</span>
                      <span className="text-ink-3 tabular-nums line-through opacity-70">{fmtVal(c.field, c.old)}</span>
                      <ArrowRight className="w-3 h-3 text-ink-3" />
                      <span className="text-ink tabular-nums">{fmtVal(c.field, c.next)}</span>
                    </span>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {total > rows.length && (
        <div className="px-3 py-2 text-[11px] text-ink-3 border-t border-line">
          Showing the first {rows.length} of {total} matched rows.
        </div>
      )}
    </div>
  );
}
