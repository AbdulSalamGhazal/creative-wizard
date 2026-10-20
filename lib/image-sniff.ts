/**
 * Detect an image's REAL type from its magic bytes (shared by every upload
 * route that stores on the public Blob host — creative thumbnails and profile
 * photos). The multipart `file.type` is client-declared and trivially
 * forgeable; anything served from a public host must be verified by content,
 * not by claim. Returns the detected MIME type, or null when the bytes match
 * none of the known formats.
 */
export function sniffImageType(head: Uint8Array): string | null {
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

/** The file extension for a sniffed type. */
export function extensionFor(mime: string): string {
  return mime === "image/jpeg" ? "jpg" : (mime.split("/")[1] ?? "img");
}
