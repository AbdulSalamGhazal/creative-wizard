import { put } from "@vercel/blob";
import { requireEditor } from "@/lib/auth";

/**
 * Thumbnail upload endpoint. Accepts a single image (multipart `file`), stores
 * it in Vercel Blob, and returns the public URL the caller saves onto the
 * creative's `thumbnailUrl`.
 *
 * The client downscales/compresses before sending (see ThumbnailUpload), so the
 * size cap here is just a safety backstop. Editor-or-admin only.
 */
export const runtime = "nodejs";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB backstop (client sends ~<300 KB)
const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

export async function POST(req: Request): Promise<Response> {
  try {
    await requireEditor();
  } catch {
    return Response.json({ error: "Not authorized." }, { status: 401 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return Response.json(
      {
        error:
          "Image storage isn't configured. Create a Vercel Blob store and set BLOB_READ_WRITE_TOKEN.",
      },
      { status: 503 },
    );
  }

  let file: FormDataEntryValue | null = null;
  try {
    const form = await req.formData();
    file = form.get("file");
  } catch {
    return Response.json({ error: "Invalid upload payload." }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return Response.json({ error: "No file provided." }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return Response.json(
      { error: "Unsupported image type (use JPG, PNG, WebP, GIF, or AVIF)." },
      { status: 415 },
    );
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "Image too large (8 MB max)." }, { status: 413 });
  }

  const ext = file.type === "image/jpeg" ? "jpg" : (file.type.split("/")[1] ?? "img");
  try {
    const blob = await put(
      `creatives/thumbnails/${crypto.randomUUID()}.${ext}`,
      file,
      {
        access: "public",
        contentType: file.type,
        addRandomSuffix: false,
        cacheControlMaxAge: 60 * 60 * 24 * 365,
      },
    );
    return Response.json({ url: blob.url });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Upload failed." },
      { status: 500 },
    );
  }
}
