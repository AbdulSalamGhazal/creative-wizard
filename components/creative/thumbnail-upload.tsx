"use client";

import { useCallback, useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const MAX_DIM = 1000; // longest edge after downscale
const WEBP_QUALITY = 0.85;
const MAX_INPUT_BYTES = 15 * 1024 * 1024; // reject absurd inputs before processing

/**
 * Downscale to <=MAX_DIM on the longest edge and re-encode as WebP, entirely in
 * the browser, so we never upload (or store) multi-MB originals — display stays
 * crisp at card + detail sizes while the file is tiny. Falls back to the
 * original file if any step of the canvas path isn't supported.
 */
async function downscaleToWebp(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/webp", WEBP_QUALITY),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

interface Props {
  value: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
}

export function ThumbnailUpload({ value, onChange, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        toast.error("Please choose an image file.");
        return;
      }
      if (file.size > MAX_INPUT_BYTES) {
        toast.error("That image is too large (15 MB max).");
        return;
      }
      const localUrl = URL.createObjectURL(file);
      setPreview(localUrl);
      setUploading(true);
      try {
        const processed = await downscaleToWebp(file);
        const fd = new FormData();
        const named = new File(
          [processed],
          processed.type === "image/webp" ? "thumbnail.webp" : file.name,
          { type: processed.type || file.type },
        );
        fd.append("file", named);
        const res = await fetch("/api/uploads/thumbnail", {
          method: "POST",
          body: fd,
        });
        const json = (await res.json()) as { url?: string; error?: string };
        if (!res.ok || !json.url) throw new Error(json.error ?? "Upload failed.");
        onChange(json.url);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setUploading(false);
        setPreview(null);
        URL.revokeObjectURL(localUrl);
      }
    },
    [onChange],
  );

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = ""; // re-selecting the same file should still fire change
  };

  // Local object URL while uploading, otherwise the saved blob URL.
  const shown = preview ?? value;

  return (
    <div className="w-full max-w-xs">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        className="hidden"
        onChange={onPick}
        disabled={disabled || uploading}
      />

      {shown ? (
        <div className="group relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-line bg-surface-2">
          {/* Plain img: works with object URLs (instant preview) and blob URLs
              without next/image remote config; the card/detail use next/image. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={shown}
            alt="Thumbnail preview"
            className="absolute inset-0 h-full w-full object-cover"
          />
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm">
              <Loader2 className="h-5 w-5 animate-spin text-ink" />
            </div>
          )}
          {!uploading && !disabled && (
            <div className="absolute inset-0 flex items-end justify-end gap-1.5 bg-gradient-to-t from-black/50 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="inline-flex items-center gap-1 h-7 px-2 rounded-md bg-background/85 backdrop-blur border border-line text-[11px] text-ink hover:bg-surface-2 transition-colors"
              >
                <Upload className="h-3 w-3" />
                Replace
              </button>
              <button
                type="button"
                onClick={() => onChange(null)}
                className="inline-flex items-center justify-center h-7 w-7 rounded-md bg-background/85 backdrop-blur border border-line text-ink-2 hover:text-neg transition-colors"
                aria-label="Remove thumbnail"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void handleFile(f);
          }}
          className={cn(
            "flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center transition-colors disabled:cursor-not-allowed disabled:opacity-60",
            dragOver
              ? "border-brand bg-[var(--brand-soft)]"
              : "border-line-2 bg-surface-2 hover:bg-surface-3",
          )}
        >
          {uploading ? (
            <Loader2 className="h-6 w-6 animate-spin text-ink-3" />
          ) : (
            <ImagePlus className="h-6 w-6 text-ink-3" />
          )}
          <span className="text-xs text-ink-2">
            {uploading ? "Uploading…" : "Click or drag an image"}
          </span>
          <span className="text-[10px] text-ink-3">
            PNG, JPG, WebP — auto-resized
          </span>
        </button>
      )}
    </div>
  );
}
