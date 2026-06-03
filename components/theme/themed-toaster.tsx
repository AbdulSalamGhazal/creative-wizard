"use client";

import { Toaster } from "sonner";

/**
 * Sonner toaster. All three app themes are dark, so sonner's own base styles
 * stay on "dark"; the custom classNames use our semantic tokens, which
 * re-tone automatically with the active theme.
 */
export function ThemedToaster() {
  return (
    <Toaster
      theme="dark"
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
