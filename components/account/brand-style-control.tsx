"use client";

import { useRef, useState, useTransition } from "react";
import { Check, ImagePlus, Loader2, Palette, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/account/brand-mark";
import { BRAND_COLORS, brandColorKey, type BrandStyle } from "@/lib/brand-style";
import { brandColorEnum, type BrandColorKey } from "@/lib/enums";
import { brandLogoForm } from "@/lib/brand-logo-upload";
import { removeBrandLogo, setBrandColor, uploadBrandLogo } from "@/app/actions/account";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";
import { cn } from "@/lib/utils";

/**
 * A brand's look (Configuration → Brands, 2026-11). The brand's mark IS the
 * button — the profile-photo pattern — and opens a popover with the colour
 * swatches and the logo's upload / remove. A swatch saves on click (the
 * action revalidates, so the page and the top bar arrive re-rendered in its
 * response); so does a logo, fitted to a 128 px WebP in the browser first.
 */
export function BrandStyleControl({ brand }: { brand: BrandStyle }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  // The swatch just clicked shows at once, before the save answers.
  const [picked, setPicked] = useState<BrandColorKey | null>(null);
  const current = picked ?? brandColorKey(brand);
  const preview = { ...brand, color: current };
  const busy = pending || uploading;

  const pick = (key: BrandColorKey) => {
    if (key === brandColorKey(brand) && brand.color) return;
    setPicked(key);
    startTransition(async () => {
      const res = await safeAction(() => setBrandColor({ id: brand.id, color: key }));
      setPicked(null);
      if (!res.ok) toastActionFailure(res, "Couldn't change the colour");
    });
  };

  const onFile = async (file: File) => {
    setUploading(true);
    const toastId = toast.loading("Uploading logo…");
    let form: FormData;
    try {
      form = await brandLogoForm(file, brand.id);
    } catch (err) {
      setUploading(false);
      toast.error(err instanceof Error ? err.message : "Couldn't read that image.", { id: toastId });
      return;
    }
    // The action revalidates: the table and the top bar arrive re-rendered.
    const res = await safeAction(() => uploadBrandLogo(form));
    setUploading(false);
    if (!res.ok) {
      toast.dismiss(toastId);
      toastActionFailure(res, "Couldn't upload the logo");
      return;
    }
    toast.success(`Updated ${brand.name}'s logo`, { id: toastId });
  };

  const remove = () => {
    startTransition(async () => {
      const res = await safeAction(() => removeBrandLogo({ id: brand.id }));
      if (!res.ok) {
        toastActionFailure(res, "Couldn't remove the logo");
        return;
      }
      toast.success("Logo removed");
    });
  };

  return (
    <>
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
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${brand.name}'s colour and logo`}
            title="Colour and logo"
            className="group/mark relative shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            <BrandMark brand={preview} size="lg" />
            {/* The mark IS the control: a palette on hover/focus says so. */}
            <span
              aria-hidden
              className="absolute inset-0 flex items-center justify-center rounded-sm bg-black/45 opacity-0 transition-opacity group-hover/mark:opacity-100 group-focus-visible/mark:opacity-100 [@media(hover:none)]:hidden"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
              ) : (
                <Palette className="h-3.5 w-3.5 text-white" />
              )}
            </span>
            {/* No hover on a touch screen: a small badge stays, so the mark
                still reads as a control (R-002). */}
            <span
              aria-hidden
              className="absolute -bottom-1 -right-1 hidden h-4 w-4 items-center justify-center rounded-full border border-line bg-surface text-ink-2 [@media(hover:none)]:flex"
            >
              <Palette className="h-2.5 w-2.5" />
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 space-y-3 p-3">
          <div className="flex items-center gap-3">
            <BrandMark brand={preview} size="xl" />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-ink">{brand.name}</div>
              <div className="text-xs text-ink-2">{BRAND_COLORS[current].label}</div>
            </div>
          </div>

          <div role="radiogroup" aria-label="Colour" className="grid grid-cols-5 gap-1.5">
            {brandColorEnum.map((key) => {
              const on = key === current;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={BRAND_COLORS[key].label}
                  title={BRAND_COLORS[key].label}
                  disabled={pending}
                  onClick={() => pick(key)}
                  className={cn(
                    "flex h-8 w-full items-center justify-center rounded-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-1 focus-visible:ring-offset-popover",
                    on ? "ring-2 ring-ink ring-offset-2 ring-offset-popover" : "hover:opacity-80",
                  )}
                  style={{ background: BRAND_COLORS[key].token }}
                >
                  {on && <Check className="h-3.5 w-3.5 text-white dark:text-background" />}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 border-t border-line pt-3">
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />}
              {brand.logoUrl ? "Change logo" : "Upload logo"}
            </Button>
            {brand.logoUrl && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={busy}
                onClick={remove}
                className="text-neg hover:text-neg"
              >
                <Trash2 className="h-3 w-3" />
                Remove
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
