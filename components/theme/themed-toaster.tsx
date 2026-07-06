"use client";

import { Toaster } from "sonner";
import { useTheme } from "next-themes";

/** The two light themes; everything else is one of the dark themes. */
const LIGHT_THEMES = new Set(["frost", "paper"]);

/**
 * Sonner toaster, driven by the active theme so its base surface matches:
 * "light" for frost/paper, "dark" for midnight/contrast. The custom
 * classNames use our semantic tokens, which re-tone automatically; the base
 * `theme` still matters for sonner's own defaults (close button, shadows).
 */
export function ThemedToaster() {
  const { theme } = useTheme();
  const sonnerTheme = theme && LIGHT_THEMES.has(theme) ? "light" : "dark";
  return (
    <Toaster
      theme={sonnerTheme}
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: "!bg-surface !border-line !text-ink",
          title: "!text-ink",
          description: "!text-ink-2",
          actionButton: "!bg-brand !text-primary-foreground",
          cancelButton: "!bg-surface-2 !text-ink-2",
        },
      }}
    />
  );
}
