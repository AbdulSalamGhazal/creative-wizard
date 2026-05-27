/**
 * Hex mirrors of the platform colors defined in app/globals.css.
 * Recharts and other DOM-renderers need literal color values, not CSS vars.
 * Keep these in sync with `--meta`, `--tiktok`, `--snapchat`, `--google`.
 */
export const PLATFORM_COLOR: Record<
  "meta" | "tiktok" | "snapchat" | "google",
  string
> = {
  meta: "#4f8efb",
  tiktok: "#ff4d7a",
  snapchat: "#ffd80b",
  google: "#34d399",
};

export const PLATFORM_LABEL: Record<
  "meta" | "tiktok" | "snapchat" | "google",
  string
> = {
  meta: "Meta",
  tiktok: "TikTok",
  snapchat: "Snapchat",
  google: "Google",
};

export const ALL_PLATFORMS = ["meta", "tiktok", "snapchat", "google"] as const;
