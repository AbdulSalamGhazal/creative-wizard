"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Dropzone } from "@/components/upload/dropzone";
import { useCan } from "@/components/auth/permissions-context";
import { int } from "@/lib/format";
import { StoreErrorReport } from "@/components/store/store-error-report";
import {
  validateStoreUpload,
  commitStoreUpload,
  type StoreUploadReport,
} from "@/app/actions/store-upload";

type Stage =
  | { s: "idle" }
  | { s: "validating" }
  | { s: "invalid"; report: Extract<StoreUploadReport, { ok: false }> }
  | { s: "valid"; report: Extract<StoreUploadReport, { ok: true }> }
  | { s: "committing"; report: Extract<StoreUploadReport, { ok: true }> }
  | { s: "committed"; inserted: number; updated: number };

/**
 * Store upload flow: pick a file → optional upsert toggle → Validate → error
 * report OR a "N new · M updated" summary → Confirm → transactional commit. The
 * same file is submitted to validate and commit (re-validated server-side).
 */
export function StoreUploadPanel() {
  const router = useRouter();
  const canUpsert = useCan("upload.upsert");
  const [file, setFile] = useState<File | null>(null);
  const [upsert, setUpsert] = useState(false);
  const [stage, setStage] = useState<Stage>({ s: "idle" });

  const busy = stage.s === "validating" || stage.s === "committing";

  function formData(): FormData {
    const fd = new FormData();
    fd.set("file", file!);
    fd.set("upsert", upsert ? "true" : "false");
    return fd;
  }

  function reset() {
    setFile(null);
    setStage({ s: "idle" });
  }

  async function onValidate() {
    if (!file) return;
    setStage({ s: "validating" });
    const report = await validateStoreUpload(formData());
    if (!report.ok) setStage({ s: "invalid", report });
    else setStage({ s: "valid", report });
  }

  async function onCommit() {
    if (stage.s !== "valid" || !file) return;
    setStage({ s: "committing", report: stage.report });
    const res = await commitStoreUpload(formData());
    if (!res.ok) {
      toast.error(res.error ?? "Commit failed");
      setStage({ s: "valid", report: stage.report });
      return;
    }
    setStage({ s: "committed", inserted: res.rowsInserted, updated: res.rowsUpdated });
    toast.success("Orders imported");
    router.refresh();
  }

  if (stage.s === "committed") {
    return (
      <div className="rounded-lg border border-line bg-surface p-5">
        <div className="flex items-center gap-2 text-sm text-ink">
          <CheckCircle2 className="h-4 w-4 text-pos" />
          Imported {int(stage.inserted)} new order{stage.inserted === 1 ? "" : "s"}
          {stage.updated > 0 && ` · updated ${int(stage.updated)}`}.
        </div>
        <div className="mt-3">
          <Button type="button" size="sm" variant="outline" onClick={reset}>
            Upload another file
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-ink">
        <UploadCloud className="h-4 w-4 text-ink-3" />
        Upload orders
      </div>

      <Dropzone
        file={file}
        onFile={(f) => {
          setFile(f);
          setStage({ s: "idle" });
        }}
        disabled={busy}
      />

      {file && canUpsert && (
        <button
          type="button"
          role="switch"
          aria-checked={upsert}
          disabled={busy}
          onClick={() => {
            setUpsert((v) => !v);
            if (stage.s !== "idle") setStage({ s: "idle" });
          }}
          className="flex items-center gap-2 text-xs text-ink-2 hover:text-ink disabled:opacity-60"
        >
          <span
            className={cn(
              "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
              upsert
                ? "border-transparent bg-[var(--brand)] text-[var(--primary-foreground)]"
                : "border-line",
            )}
            aria-hidden
          >
            {upsert && <CheckCircle2 className="h-3 w-3" />}
          </span>
          Upsert — update orders that already exist (instead of erroring)
        </button>
      )}

      {stage.s === "invalid" && (
        <StoreErrorReport
          errors={stage.report.errors}
          warnings={stage.report.warnings}
        />
      )}

      {(stage.s === "valid" || stage.s === "committing") && (
        <div className="rounded-md border border-line bg-surface-2 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-pos/10 px-2 py-0.5 text-xs text-pos">
              {int(stage.report.summary.newCount)} new
            </span>
            {stage.report.summary.upsert && (
              <span className="rounded bg-brand/10 px-2 py-0.5 text-xs text-ink-2">
                {int(stage.report.summary.updatedCount)} updated
              </span>
            )}
            <span className="text-ink-3">
              · {int(stage.report.summary.total)} rows valid
            </span>
          </div>
          {stage.report.summary.ignoredColumns.length > 0 && (
            <p className="mt-1.5 text-[11px] text-ink-3">
              Ignored columns:{" "}
              <span className="font-mono">
                {stage.report.summary.ignoredColumns.join(", ")}
              </span>
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        {stage.s === "valid" || stage.s === "committing" ? (
          <>
            <Button type="button" size="sm" onClick={onCommit} disabled={busy}>
              {stage.s === "committing" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              Confirm import
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setStage({ s: "idle" })}
              disabled={busy}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button type="button" size="sm" onClick={onValidate} disabled={!file || busy}>
            {stage.s === "validating" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            Validate
          </Button>
        )}
      </div>
    </div>
  );
}
