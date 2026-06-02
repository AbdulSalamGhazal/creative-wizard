"use client";

import { useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * One-click screenshot of the current page straight to the clipboard — no
 * region selection, no browser "share screen" prompt. Renders the live DOM to
 * a PNG (via modern-screenshot's SVG-foreignObject path, so the app's CSS
 * variables / color-mix render correctly) and writes it to the clipboard with
 * the async Clipboard API. Falls back to a file download where clipboard image
 * writes aren't supported.
 *
 * The button itself and the toast layer are tagged so they're excluded from
 * the capture.
 */
export function ScreenshotButton() {
  const [busy, setBusy] = useState(false);

  const capture = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { domToBlob } = await import("modern-screenshot");

      const bodyBg = getComputedStyle(document.body).backgroundColor;
      const backgroundColor =
        bodyBg && bodyBg !== "rgba(0, 0, 0, 0)" && bodyBg !== "transparent"
          ? bodyBg
          : getComputedStyle(document.documentElement).backgroundColor;

      const blob = await domToBlob(document.body, {
        // Crisp on hi-DPI screens, capped so huge pages stay a sane size.
        scale: Math.min(2, window.devicePixelRatio || 1),
        backgroundColor,
        filter: (node) => {
          if (node instanceof Element) {
            if (node.hasAttribute("data-screenshot-exclude")) return false;
            // sonner's toast container
            if (node.hasAttribute("data-sonner-toaster")) return false;
          }
          return true;
        },
      });

      if (!blob) throw new Error("Capture produced no image.");

      const canClipboardImage =
        typeof ClipboardItem !== "undefined" &&
        !!navigator.clipboard?.write;

      if (canClipboardImage) {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob }),
          ]);
          toast.success("Screenshot copied to clipboard");
          return;
        } catch {
          // Fall through to download (clipboard blocked / not focused).
        }
      }

      downloadBlob(blob);
      toast("Couldn't reach the clipboard — saved the screenshot as a file");
    } catch (err) {
      toast.error(
        err instanceof Error ? `Screenshot failed: ${err.message}` : "Screenshot failed",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      data-screenshot-exclude
      onClick={capture}
      disabled={busy}
      title="Copy a screenshot of this page to the clipboard"
      aria-label="Copy screenshot to clipboard"
      className={cn(
        "inline-flex items-center justify-center h-8 w-8 rounded-md border border-line",
        "text-ink-2 hover:text-ink hover:bg-surface-2 transition-colors",
        "disabled:opacity-60 disabled:cursor-wait",
      )}
    >
      {busy ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Camera className="w-4 h-4" />
      )}
    </button>
  );
}

function downloadBlob(blob: Blob) {
  const stamp = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, "-");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `creative-wizard-${stamp}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
