import { seriesColor } from "@/lib/palette";

/**
 * Deterministic person avatars — initials plus a colour derived from the name,
 * so the same person always looks the same wherever they appear and nothing
 * has to be stored. The colours are the shared series vars, which already have
 * light-theme overrides, rather than a second palette nobody would maintain.
 */

/** "Abdulsalam Ghazal" → "AG"; one word → one letter; nothing → "?". */
export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const initials = parts.map((p) => [...p][0]?.toUpperCase() ?? "").join("");
  return initials || "?";
}

/** A stable small hash — same name, same bucket, on every render and device. */
function hash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** The avatar's background: one of the shared series colours, by name. */
export function avatarColor(name: string | null | undefined): string {
  return seriesColor(hash((name ?? "").trim().toLowerCase()));
}
