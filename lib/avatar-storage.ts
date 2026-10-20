import { del, put } from "@vercel/blob";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { extensionFor } from "@/lib/image-sniff";

/**
 * Where profile photos live (2026-10-20). PRODUCTION: Vercel Blob, public —
 * exactly like creative thumbnails (`BLOB_READ_WRITE_TOKEN`; the host is
 * allow-listed in next.config.ts). LOCAL DEV with no token: a file under
 * `public/dev-uploads/avatars/` (gitignored), so the feature can be walked
 * without writing to a real store. The fallback is unreachable in
 * production: it requires BOTH no token AND `NODE_ENV !== "production"`.
 */

const BLOB_PREFIX = "avatars/";
const DEV_DIR = path.join(process.cwd(), "public", "dev-uploads", "avatars");
const DEV_URL_PREFIX = "/dev-uploads/avatars/";

export type AvatarStore = "blob" | "dev" | null;

/** Which store is usable here — null when none (the route answers 503). */
export function avatarStore(env: Record<string, string | undefined> = process.env): AvatarStore {
  if (env.BLOB_READ_WRITE_TOKEN) return "blob";
  if (env.NODE_ENV !== "production") return "dev";
  return null;
}

/** Store one sniffed image for `userId`; resolves its public URL. */
export async function storeAvatar(file: Blob, mime: string, userId: string): Promise<string> {
  const name = `${userId}-${crypto.randomUUID()}.${extensionFor(mime)}`;
  const store = avatarStore();
  if (store === "blob") {
    const blob = await put(`${BLOB_PREFIX}${name}`, file, {
      access: "public",
      contentType: mime,
      addRandomSuffix: false,
      cacheControlMaxAge: 60 * 60 * 24 * 365,
    });
    return blob.url;
  }
  if (store === "dev") {
    await mkdir(DEV_DIR, { recursive: true });
    await writeFile(path.join(DEV_DIR, name), Buffer.from(await file.arrayBuffer()));
    return `${DEV_URL_PREFIX}${name}`;
  }
  throw new Error("Image storage isn't configured.");
}

/**
 * Is this a URL WE stored as a profile photo? Only those may be deleted or
 * written to `users.avatar_url` — the column never holds an arbitrary URL.
 */
export function isOwnAvatarUrl(url: string): boolean {
  if (url.startsWith(DEV_URL_PREFIX)) return !url.includes("..");
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      u.hostname.endsWith(".public.blob.vercel-storage.com") &&
      u.pathname.startsWith(`/${BLOB_PREFIX}`)
    );
  } catch {
    return false;
  }
}

/**
 * Delete a replaced or removed photo — BEST EFFORT: a person's photo should
 * not linger on a public host after they removed it, but a failed delete must
 * never fail the change they asked for. Only our own URLs are touched.
 */
export async function discardAvatar(url: string | null | undefined): Promise<void> {
  if (!url || !isOwnAvatarUrl(url)) return;
  try {
    if (url.startsWith(DEV_URL_PREFIX)) {
      await unlink(path.join(DEV_DIR, path.basename(url)));
      return;
    }
    if (process.env.BLOB_READ_WRITE_TOKEN) await del(url);
  } catch (err) {
    console.warn("Discarding an old profile photo failed:", err);
  }
}
