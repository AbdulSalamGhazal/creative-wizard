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

/**
 * Detect the real image type from the file's magic bytes. The multipart
 * `file.type` is client-declared and trivially forgeable — anything stored on
 * the public Blob host must be verified by content, not by claim. Returns the
 * detected MIME type, or null when the bytes match none of the allowed formats.
 */
function sniffImageType(head: Uint8Array): string | null {
  const ascii = (start: number, len: number) =>
    String.fromCharCode(...head.slice(start, start + len));
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff)
    return "image/jpeg";
  if (
    head.length >= 8 &&
    head[0] === 0x89 &&
    ascii(1, 3) === "PNG" &&
    head[4] === 0x0d &&
    head[5] === 0x0a &&
    head[6] === 0x1a &&
    head[7] === 0x0a
  )
    return "image/png";
  if (head.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a"))
    return "image/gif";
  if (head.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP")
    return "image/webp";
  // ISO BMFF: size(4) + "ftyp" + major brand ("avif" still / "avis" sequence).
  if (
    head.length >= 12 &&
    ascii(4, 4) === "ftyp" &&
    (ascii(8, 4) === "avif" || ascii(8, 4) === "avis")
  )
    return "image/avif";
  return null;
}

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

  // Verify by content: the declared MIME check above is only a fast pre-filter.
  // The stored contentType and extension come from the SNIFFED type, so a file
  // that lies about its type can't be served from the Blob host as an image.
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const sniffed = sniffImageType(head);
  if (!sniffed || !ALLOWED.has(sniffed)) {
    return Response.json(
      { error: "File content is not a supported image (JPG, PNG, WebP, GIF, or AVIF)." },
      { status: 415 },
    );
  }

  const ext = sniffed === "image/jpeg" ? "jpg" : (sniffed.split("/")[1] ?? "img");
  try {
    const blob = await put(
      `creatives/thumbnails/${crypto.randomUUID()}.${ext}`,
      file,
      {
        access: "public",
        contentType: sniffed,
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
