import { del, put } from "@vercel/blob";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { extensionFor } from "@/lib/image-sniff";

/**
 * Where profile photos (2026-10-20) and brand logos (2026-11) live. PRODUCTION: Vercel Blob, public —
 * exactly like creative thumbnails (`BLOB_READ_WRITE_TOKEN`; the host is
 * allow-listed in next.config.ts). LOCAL DEV with no token: a file under
 * `public/dev-uploads/avatars/` (gitignored), so the feature can be walked
 * without writing to a real store. The fallback is unreachable in
 * production: it requires BOTH no token AND `NODE_ENV !== "production"`.
 */

/**
 * The two people-and-brand image folders (2026-11: brand logos joined avatars).
 * Same host, same rules, separate prefixes — so a URL from one can never be
 * written to, or deleted through, the other.
 */
export type ImageFolder = "avatars" | "brand-logos";

const blobPrefix = (folder: ImageFolder) => `${folder}/`;
const devDir = (folder: ImageFolder) => path.join(process.cwd(), "public", "dev-uploads", folder);
const devUrlPrefix = (folder: ImageFolder) => `/dev-uploads/${folder}/`;

export type AvatarStore = "blob" | "dev" | null;

/** Which store is usable here — null when none (the route answers 503). */
export function avatarStore(env: Record<string, string | undefined> = process.env): AvatarStore {
  if (env.BLOB_READ_WRITE_TOKEN) return "blob";
  if (env.NODE_ENV !== "production") return "dev";
  return null;
}

/** Store one sniffed image named for `ownerId` in `folder`; resolves its public URL. */
export async function storeImage(
  file: Blob,
  mime: string,
  ownerId: string,
  folder: ImageFolder,
): Promise<string> {
  const name = `${ownerId}-${crypto.randomUUID()}.${extensionFor(mime)}`;
  const store = avatarStore();
  if (store === "blob") {
    const blob = await put(`${blobPrefix(folder)}${name}`, file, {
      access: "public",
      contentType: mime,
      addRandomSuffix: false,
      cacheControlMaxAge: 60 * 60 * 24 * 365,
    });
    return blob.url;
  }
  if (store === "dev") {
    const dir = devDir(folder);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));
    return `${devUrlPrefix(folder)}${name}`;
  }
  throw new Error("Image storage isn't configured.");
}

/**
 * Is this a URL WE stored in `folder`? Only those may be deleted or written
 * to the column — it never holds an arbitrary URL.
 */
export function isOwnImageUrl(url: string, folder: ImageFolder): boolean {
  if (url.startsWith(devUrlPrefix(folder))) return !url.includes("..");
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      u.hostname.endsWith(".public.blob.vercel-storage.com") &&
      u.pathname.startsWith(`/${blobPrefix(folder)}`)
    );
  } catch {
    return false;
  }
}

/**
 * Delete a replaced or removed image — BEST EFFORT: it should not linger on a
 * public host after it was removed, but a failed delete must never fail the
 * change that was asked for. Only our own URLs are touched.
 */
export async function discardImage(url: string | null | undefined, folder: ImageFolder): Promise<void> {
  if (!url || !isOwnImageUrl(url, folder)) return;
  try {
    if (url.startsWith(devUrlPrefix(folder))) {
      await unlink(path.join(devDir(folder), path.basename(url)));
      return;
    }
    if (process.env.BLOB_READ_WRITE_TOKEN) await del(url);
  } catch (err) {
    console.warn(`Discarding an old image (${folder}) failed:`, err);
  }
}

/** Store one sniffed profile photo for `userId`; resolves its public URL. */
export const storeAvatar = (file: Blob, mime: string, userId: string): Promise<string> =>
  storeImage(file, mime, userId, "avatars");
/** Is this a profile photo WE stored? */
export const isOwnAvatarUrl = (url: string): boolean => isOwnImageUrl(url, "avatars");
/** Delete a replaced or removed profile photo (best effort). */
export const discardAvatar = (url: string | null | undefined): Promise<void> =>
  discardImage(url, "avatars");
