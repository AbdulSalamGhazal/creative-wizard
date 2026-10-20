"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar, type AvatarSize } from "@/components/user/user-avatar";
import { AVATAR_CHANGED_EVENT, uploadAvatar } from "@/lib/avatar-upload";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";
import { removeMyAvatar, removeUserAvatar } from "@/app/actions/avatar";

/**
 * Pick, upload and remove a profile photo (2026-10-20). The ONE state machine
 * behind both entry points: the account menu (yours — `userId` omitted, so the
 * request carries no id) and the Team page (anyone's — `users.manage`, checked
 * on the server). After a change the page refreshes so the top bar and every
 * avatar re-read the photo.
 */
export function usePhotoChange({ userId, name }: { userId?: string; name: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = () => inputRef.current?.click();

  const onFile = async (file: File) => {
    setBusy(true);
    const toastId = toast.loading("Uploading photo…");
    const res = await uploadAvatar(file, userId);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error, { id: toastId });
      return;
    }
    toast.success(userId ? `Updated ${name}'s photo` : "Photo updated", { id: toastId });
    window.dispatchEvent(new Event(AVATAR_CHANGED_EVENT));
    router.refresh();
  };

  const remove = async () => {
    setBusy(true);
    const res = await safeAction(() =>
      userId ? removeUserAvatar({ userId }) : removeMyAvatar(),
    );
    setBusy(false);
    if (!res.ok) {
      toastActionFailure(res, "Couldn't remove the photo.");
      return;
    }
    toast.success("Photo removed");
    window.dispatchEvent(new Event(AVATAR_CHANGED_EVENT));
    router.refresh();
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        // Re-selecting the same file must still fire.
        e.target.value = "";
        if (file) void onFile(file);
      }}
    />
  );

  return { busy, pick, remove, input };
}

/**
 * The Team page's control: the person's avatar IS the button; its menu offers
 * "Upload photo" / "Change photo" and, when there is one, "Remove photo".
 */
export function UserPhotoControl({
  userId,
  name,
  avatarUrl,
  size = "lg",
}: {
  userId: string;
  name: string;
  avatarUrl: string | null;
  size?: AvatarSize;
}) {
  const { busy, pick, remove, input } = usePhotoChange({ userId, name });
  return (
    <>
      {input}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={busy}
            aria-label={`${name}'s photo`}
            title={avatarUrl ? "Change or remove photo" : "Upload photo"}
            className="group/photo relative shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            <UserAvatar name={name} src={avatarUrl} size={size} />
            {/* The avatar IS the control: a camera on hover/focus says so. */}
            {!busy && (
              <span
                aria-hidden
                className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 opacity-0 transition-opacity group-hover/photo:opacity-100 group-focus-visible/photo:opacity-100 [@media(hover:none)]:opacity-0"
              >
                <Camera className="h-3.5 w-3.5 text-white" />
              </span>
            )}
            {busy && (
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/60">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-ink" />
              </span>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuItem onSelect={pick}>
            <ImagePlus className="h-3.5 w-3.5" />
            {avatarUrl ? "Change photo" : "Upload photo"}
          </DropdownMenuItem>
          {avatarUrl && (
            <DropdownMenuItem onSelect={() => void remove()} className="text-neg focus:text-neg">
              <Trash2 className="h-3.5 w-3.5" />
              Remove photo
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
