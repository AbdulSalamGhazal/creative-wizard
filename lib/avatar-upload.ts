/**
 * The browser half of profile photos (2026-10-20) — modelled on the creative
 * thumbnail's downscaler, but SQUARE: a centre crop of the shorter side,
 * scaled to `AVATAR_PX`, re-encoded as WebP. So a 12 MP phone photo leaves the
 * device as a few KB, and every avatar on every surface is the same shape.
 */

export const AVATAR_PX = 256;

/**
 * Announced on `window` after a photo changes, so surfaces that loaded people
 * client-side (the comment panel) reload them — the top bar follows from the
 * page refresh, a thread fetched earlier would not.
 */
export const AVATAR_CHANGED_EVENT = "cw:avatar-changed";
const WEBP_QUALITY = 0.85;
/** Reject absurd inputs before decoding them. */
export const AVATAR_MAX_INPUT_BYTES = 15 * 1024 * 1024;

/** The centre square of a w×h image, as a source rectangle. */
export function centreSquare(w: number, h: number): { sx: number; sy: number; side: number } {
  const side = Math.min(w, h);
  return { sx: Math.round((w - side) / 2), sy: Math.round((h - side) / 2), side };
}

/** Crop to the centre square, scale to AVATAR_PX, encode WebP. */
export async function downscaleAvatar(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { sx, sy, side } = centreSquare(bitmap.width, bitmap.height);
  const out = Math.min(AVATAR_PX, side);
  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't resize images.");
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/webp", WEBP_QUALITY),
  );
  if (!blob) throw new Error("This browser can't encode the photo.");
  return blob;
}

/**
 * Upload a photo — yours (no `userId`), or someone's on the Team page (the
 * route checks `users.manage`). Resolves `{ ok, url }` or `{ ok: false, error }`
 * and never rejects, so callers can toast it like an action result.
 */
export async function uploadAvatar(
  file: File,
  userId?: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!file.type.startsWith("image/")) return { ok: false, error: "Choose an image." };
  if (file.size > AVATAR_MAX_INPUT_BYTES) return { ok: false, error: "Image too large (15 MB max)." };
  try {
    const square = await downscaleAvatar(file);
    const form = new FormData();
    form.append("file", new File([square], "avatar.webp", { type: "image/webp" }));
    if (userId) form.append("userId", userId);
    const res = await fetch("/api/uploads/avatar", { method: "POST", body: form });
    const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !json.url) return { ok: false, error: json.error ?? "Upload failed." };
    return { ok: true, url: json.url };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Upload failed." };
  }
}
