"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, ChevronDown, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { PLATFORM_LABEL } from "@/lib/palette";
import type { ValidationError } from "@/csv/errors";

type Platform = "meta" | "tiktok" | "snapchat" | "google";

interface Summary {
  rows: number;
  creatives: number;
  dateRange: { from: string; to: string } | null;
}

interface Detection {
  used: "auto" | "explicit";
  platform: Platform | null;
  ambiguous: boolean;
  scores: Record<Platform, number>;
}

type Stage =
  | { kind: "idle" }
  | { kind: "validating" }
  | {
      kind: "invalid";
      errors: ValidationError[];
      warnings: ValidationError[];
      detection: Detection | null;
    }
  | {
      kind: "valid";
      token: string;
      summary: Summary;
      warnings: ValidationError[];
      detection: Detection;
    }
  | { kind: "committing"; token: string }
  | { kind: "committed"; batchId: string; rowsImported: number; platform: Platform | null }
  | { kind: "error"; message: string };

const PLATFORMS: Array<{ value: Platform; label: string }> = [
  { value: "meta", label: "Meta" },
  { value: "tiktok", label: "TikTok" },
  { value: "snapchat", label: "Snapchat" },
  { value: "google", label: "Google" },
];

export function UploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  // null = let the server auto-detect.
  const [platformOverride, setPlatformOverride] = useState<Platform | null>(null);
  const [showOverride, setShowOverride] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });

  const reset = () => {
    setFile(null);
    setPlatformOverride(null);
    setShowOverride(false);
    setStage({ kind: "idle" });
  };

  const onValidate = async () => {
    if (!file) return;
    setStage({ kind: "validating" });

    const form = new FormData();
    if (platformOverride) form.set("platform", platformOverride);
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
      const d = data as {
        errors: ValidationError[];
        warnings: ValidationError[];
        detection?: Detection;
      };
      setStage({
        kind: "invalid",
        errors: d.errors,
        warnings: d.warnings,
        detection: d.detection ?? null,
      });
      return;
    }
    if (res.status === 413) {
      const d = data as { error: string };
      setStage({
        kind: "invalid",
        errors: [{ code: "E001", severity: "FATAL", message: d.error }],
        warnings: [],
        detection: null,
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
      detection: Detection;
    };
    setStage({
      kind: "valid",
      token: ok.token,
      summary: ok.summary,
      warnings: ok.warnings,
      detection: ok.detection,
    });
  };

  const onCommit = async () => {
    if (stage.kind !== "valid") return;
    const token = stage.token;
    const detectedPlatform = stage.detection.platform;
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
      platform: detectedPlatform,
    });
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
          {stage.rowsImported} performance records imported
          {stage.platform && (
            <>
              {" "}for <span className="text-ink">{PLATFORM_LABEL[stage.platform]}</span>
            </>
          )}
          .
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
      <div className="space-y-1.5">
        <div className="text-sm text-ink">File</div>
        <Dropzone file={file} onFile={setFile} disabled={busy} />
      </div>

      {/* Platform override (collapsed by default) */}
      {file && stage.kind === "idle" && (
        <details
          className="rounded-md border border-line bg-surface px-3 py-2"
          open={showOverride}
        >
          <summary
            className="cursor-pointer text-xs text-ink-3 hover:text-ink list-none flex items-center gap-2"
            onClick={(e) => {
              e.preventDefault();
              setShowOverride((s) => !s);
            }}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Platform will be auto-detected from your file&apos;s headers.
            <span className="ml-auto inline-flex items-center gap-1 text-ink-3">
              Override
              <ChevronDown
                className={`w-3 h-3 transition-transform ${
                  showOverride ? "rotate-180" : ""
                }`}
              />
            </span>
          </summary>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-[200px_1fr] gap-3 items-center">
            <Select
              value={platformOverride ?? "auto"}
              onValueChange={(v) =>
                setPlatformOverride(v === "auto" ? null : (v as Platform))
              }
              disabled={busy}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto-detect</SelectItem>
                {PLATFORMS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[11px] text-ink-3">
              Only pick a platform here if auto-detect picks the wrong one.
            </span>
          </div>
        </details>
      )}

      {stage.kind === "idle" && (
        <div className="flex items-center justify-end">
          <Button onClick={onValidate} disabled={!file}>
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
          {stage.detection?.platform && (
            <DetectionBanner detection={stage.detection} />
          )}
          <ErrorReport errors={stage.errors} warnings={stage.warnings} />
          <div className="flex items-center justify-between gap-2">
            <PlatformOverrideInline
              value={platformOverride}
              onChange={setPlatformOverride}
              disabled={busy}
            />
            <div className="flex gap-2">
              <Button variant="ghost" onClick={reset}>
                Start over
              </Button>
              <Button onClick={onValidate} disabled={!file}>
                <RefreshCw className="w-3.5 h-3.5" />
                Try again
              </Button>
            </div>
          </div>
        </>
      )}

      {stage.kind === "valid" && (
        <>
          <DetectionBanner detection={stage.detection} />
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

function DetectionBanner({ detection }: { detection: Detection }) {
  if (!detection.platform) return null;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs flex items-center gap-2">
      <Sparkles className="w-3.5 h-3.5 text-brand-2" />
      <span className="text-ink-3">Detected platform:</span>
      <span className="text-ink">{PLATFORM_LABEL[detection.platform]}</span>
      <span className="text-ink-3">·</span>
      <span className="text-ink-3">
        {detection.used === "explicit" ? "your override" : "auto"}
      </span>
      {detection.ambiguous && detection.used === "auto" && (
        <span className="ml-2 text-warn">
          (other platforms matched too — override below if this is wrong)
        </span>
      )}
    </div>
  );
}

function PlatformOverrideInline({
  value,
  onChange,
  disabled,
}: {
  value: Platform | null;
  onChange: (v: Platform | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-ink-3">Platform:</span>
      <Select
        value={value ?? "auto"}
        onValueChange={(v) => onChange(v === "auto" ? null : (v as Platform))}
        disabled={disabled}
      >
        <SelectTrigger className="h-8 w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">Auto-detect</SelectItem>
          {PLATFORMS.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
