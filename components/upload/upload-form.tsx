"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dropzone } from "@/components/upload/dropzone";
import { ErrorReport } from "@/components/upload/error-report";
import { SummaryCard } from "@/components/upload/summary-card";
import type { ValidationError } from "@/csv/errors";

type Platform = "meta" | "tiktok" | "snapchat" | "google";

interface Summary {
  rows: number;
  creatives: number;
  dateRange: { from: string; to: string } | null;
}

type Stage =
  | { kind: "idle" }
  | { kind: "validating" }
  | { kind: "invalid"; errors: ValidationError[]; warnings: ValidationError[] }
  | { kind: "valid"; token: string; summary: Summary; warnings: ValidationError[] }
  | { kind: "committing"; token: string }
  | { kind: "committed"; batchId: string; rowsImported: number }
  | { kind: "error"; message: string };

const PLATFORMS: Array<{ value: Platform; label: string }> = [
  { value: "meta", label: "Meta" },
  { value: "tiktok", label: "TikTok" },
  { value: "snapchat", label: "Snapchat" },
  { value: "google", label: "Google" },
];

export function UploadForm() {
  const router = useRouter();
  const [platform, setPlatform] = useState<Platform>("meta");
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });

  const reset = () => {
    setFile(null);
    setStage({ kind: "idle" });
  };

  const onValidate = async () => {
    if (!file) return;
    setStage({ kind: "validating" });

    const form = new FormData();
    form.set("platform", platform);
    form.set("file", file);

    let res: Response;
    try {
      res = await fetch("/api/uploads/validate", {
        method: "POST",
        body: form,
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

    if (res.status === 422) {
      const d = data as { errors: ValidationError[]; warnings: ValidationError[] };
      setStage({ kind: "invalid", errors: d.errors, warnings: d.warnings });
      return;
    }
    if (res.status === 413) {
      const d = data as { error: string };
      setStage({
        kind: "invalid",
        errors: [
          { code: "E001", severity: "FATAL", message: d.error },
        ],
        warnings: [],
      });
      return;
    }
    if (!res.ok) {
      const d = data as { error?: string };
      setStage({
        kind: "error",
        message: d.error ?? `Validate failed (HTTP ${res.status})`,
      });
      return;
    }

    const ok = data as {
      token: string;
      summary: Summary;
      warnings: ValidationError[];
    };
    setStage({
      kind: "valid",
      token: ok.token,
      summary: ok.summary,
      warnings: ok.warnings,
    });
  };

  const onCommit = async () => {
    if (stage.kind !== "valid") return;
    const token = stage.token;
    setStage({ kind: "committing", token });

    let res: Response;
    try {
      res = await fetch("/api/uploads/commit", {
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
      setStage({
        kind: "error",
        message: d.error ?? `Commit failed (HTTP ${res.status})`,
      });
      return;
    }

    const ok = data as { batchId: string; rowsImported: number };
    setStage({
      kind: "committed",
      batchId: ok.batchId,
      rowsImported: ok.rowsImported,
    });
    // Force a refresh so the Overview/Library reflect the new batch.
    router.refresh();
  };

  // ---- Render ----
  if (stage.kind === "committed") {
    return (
      <div className="rounded-lg border border-pos/30 bg-pos/5 px-6 py-8 text-center">
        <div className="w-12 h-12 rounded-full bg-pos/15 border border-pos/30 mx-auto flex items-center justify-center">
          <Check className="w-5 h-5 text-pos" />
        </div>
        <h2 className="mt-4 font-display text-3xl tracking-tight">Upload committed</h2>
        <p className="mt-2 text-ink-2 text-sm num">
          {stage.rowsImported} performance records imported.
        </p>
        <p className="mt-1 text-ink-3 text-[11px] font-mono">
          Batch {stage.batchId}
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button asChild>
            <Link href="/">View on Overview</Link>
          </Button>
          <Button variant="ghost" onClick={reset}>
            <RefreshCw className="w-3.5 h-3.5" />
            Upload another
          </Button>
        </div>
      </div>
    );
  }

  const busy = stage.kind === "validating" || stage.kind === "committing";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4 items-start">
        <div className="space-y-1.5">
          <Label htmlFor="platform">Platform</Label>
          <Select
            value={platform}
            onValueChange={(v) => setPlatform(v as Platform)}
            disabled={busy}
          >
            <SelectTrigger id="platform" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLATFORMS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>File</Label>
          <Dropzone file={file} onFile={setFile} disabled={busy} />
        </div>
      </div>

      {stage.kind === "idle" && (
        <div className="flex items-center justify-end">
          <Button
            onClick={onValidate}
            disabled={!file}
          >
            Validate
          </Button>
        </div>
      )}

      {stage.kind === "validating" && (
        <div className="rounded-lg border border-line bg-surface px-4 py-3 flex items-center gap-3">
          <Loader2 className="w-4 h-4 animate-spin text-brand" />
          <span className="text-sm text-ink-2">Running validation pipeline…</span>
        </div>
      )}

      {stage.kind === "invalid" && (
        <>
          <ErrorReport errors={stage.errors} warnings={stage.warnings} />
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={reset}>
              Start over
            </Button>
            <Button onClick={onValidate} disabled={!file}>
              <RefreshCw className="w-3.5 h-3.5" />
              Try again
            </Button>
          </div>
        </>
      )}

      {stage.kind === "valid" && (
        <>
          <SummaryCard summary={stage.summary} warnings={stage.warnings} />
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={reset}>
              Cancel
            </Button>
            <Button onClick={onCommit}>Confirm import</Button>
          </div>
        </>
      )}

      {stage.kind === "committing" && (
        <div className="rounded-lg border border-line bg-surface px-4 py-3 flex items-center gap-3">
          <Loader2 className="w-4 h-4 animate-spin text-brand" />
          <span className="text-sm text-ink-2">Committing rows…</span>
        </div>
      )}

      {stage.kind === "error" && (
        <div className="rounded-lg border border-neg/30 bg-neg/5 px-4 py-3 text-sm text-ink space-y-2">
          <div>{stage.message}</div>
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={reset}>
              Reset
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
