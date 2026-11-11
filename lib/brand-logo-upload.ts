/**
 * The browser half of brand logos (2026-11). Unlike a profile photo, a logo
 * is never CROPPED — a wide wordmark would lose its ends — it is FITTED
 * (contain) into a transparent square of `BRAND_LOGO_PX`, then encoded as WebP
 * (which keeps the transparency). So every logo is the same shape on every
 * surface and leaves the device as a few KB.
 */

export const BRAND_LOGO_PX = 128;
const WEBP_QUALITY = 0.9;
/** Reject absurd inputs before decoding them. */
export const BRAND_LOGO_MAX_INPUT_BYTES = 15 * 1024 * 1024;

/** Where a w×h image sits inside a `box`-sized square, scaled to fit. */
export function containRect(w: number, h: number, box: number): { dx: number; dy: number; dw: number; dh: number } {
  const scale = Math.min(box / w, box / h, 1);
  const dw = Math.round(w * scale);
  const dh = Math.round(h * scale);
  return { dx: Math.round((box - dw) / 2), dy: Math.round((box - dh) / 2), dw, dh };
}

export async function fitBrandLogo(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const box = Math.min(BRAND_LOGO_PX, Math.max(bitmap.width, bitmap.height));
  const { dx, dy, dw, dh } = containRect(bitmap.width, bitmap.height, box);
  const canvas = document.createElement("canvas");
  canvas.width = box;
  canvas.height = box;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't resize images.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, dx, dy, dw, dh);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/webp", WEBP_QUALITY),
  );
  if (!blob) throw new Error("This browser can't encode the logo.");
  return blob;
}

/** Fit `file` into the upload's square WebP, ready for `uploadBrandLogo`. */
export async function brandLogoForm(file: File, accountId: string): Promise<FormData> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image.");
  if (file.size > BRAND_LOGO_MAX_INPUT_BYTES) throw new Error("Image too large (15 MB max).");
  const square = await fitBrandLogo(file);
  const form = new FormData();
  form.append("file", new File([square], "logo.webp", { type: "image/webp" }));
  form.append("accountId", accountId);
  return form;
}
