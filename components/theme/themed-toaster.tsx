"use client";

import { useTheme } from "next-themes";
import { Toaster } from "sonner";

/**
 * Sonner toaster that follows the active theme. The custom classNames use our
 * semantic tokens (which flip with the theme automatically); passing `theme`
 * keeps sonner's own base styles (e.g. close button, default surfaces) in sync.
 */
export function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      theme={resolvedTheme === "light" ? "light" : "dark"}
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: "!bg-surface !border-line !text-ink",
          title: "!text-ink",
          description: "!text-ink-2",
          actionButton: "!bg-brand !text-white",
          cancelButton: "!bg-surface-2 !text-ink-2",
        },
      }}
    />
  );
}
