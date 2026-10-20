import { auth, can } from "@/lib/auth";
import { sniffImageType } from "@/lib/image-sniff";
import { avatarStore, discardAvatar, storeAvatar } from "@/lib/avatar-storage";
import { writeAvatar } from "@/lib/avatar-write";
import { avatarUploadTargetSchema } from "@/validators/avatar";

/**
 * Profile-photo upload (2026-10-20) — modelled on the creative-thumbnail
 * route. Multipart `file` (the browser already cropped it to a SQUARE WebP of
 * ~256 px, see `downscaleAvatar`), and an optional `userId`:
 *
 *  - no `userId` → YOUR OWN photo. Signed in is enough; the session user is
 *    the subject, so there is no id to forge.
 *  - a `userId` that isn't yours → the Team page's admin path, behind
 *    `users.manage` (the permission that already gates editing people).
 *
 * The bytes are verified by content (magic bytes), never by the declared type,
 * because the file is served from a public host. Stores, then writes the URL
 * through `writeAvatar` — which also discards the replaced photo and audits.
 */
export const runtime = "nodejs";

/** A backstop: the client sends a ~256 px WebP of a few KB. */
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = new Set(["image/webp", "image/jpeg", "image/png"]);

export async function POST(req: Request): Promise<Response> {
  const me = await auth();
  if (!me) return Response.json({ error: "Not signed in." }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Invalid upload." }, { status: 400 });
  }

  const rawTarget = form.get("userId");
  const parsedTarget = avatarUploadTargetSchema.safeParse(
    typeof rawTarget === "string" && rawTarget !== "" ? rawTarget : null,
  );
  if (!parsedTarget.success) {
    return Response.json({ error: "Invalid person." }, { status: 400 });
  }
  const targetUserId = parsedTarget.data ?? me.id;
  if (targetUserId !== me.id && !can(me, "users.manage")) {
    return Response.json({ error: "You can only change your own photo." }, { status: 403 });
  }

  if (avatarStore() === null) {
    return Response.json(
      { error: "Image storage isn't configured (BLOB_READ_WRITE_TOKEN)." },
      { status: 503 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No image provided." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "Image too large (2 MB max)." }, { status: 413 });
  }
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const sniffed = sniffImageType(head);
  if (!sniffed || !ALLOWED.has(sniffed)) {
    return Response.json({ error: "Use a JPG, PNG or WebP image." }, { status: 415 });
  }

  let url: string;
  try {
    url = await storeAvatar(file, sniffed, targetUserId);
  } catch (err) {
    console.error("[avatar] store failed", err);
    return Response.json({ error: "Upload failed." }, { status: 500 });
  }

  const written = await writeAvatar({ targetUserId, url, actorUserId: me.id });
  if (!written.ok) {
    await discardAvatar(url);
    return Response.json({ error: written.error }, { status: 404 });
  }
  return Response.json({ url });
}
