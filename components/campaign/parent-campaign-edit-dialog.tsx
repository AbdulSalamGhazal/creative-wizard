"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "@/lib/brand-nav";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { campaignNameHasSeparator, campaignPath } from "@/lib/campaign";
import { updateParentCampaign } from "@/app/actions/campaign";
import { safeAction } from "@/lib/action-failure";
import { actionSettled } from "@/lib/router-queue";
import { toastActionFailure } from "@/lib/action-toast";
import { useCan } from "@/components/auth/permissions-context";
import { useNavTransition } from "@/lib/nav-progress";
import { int } from "@/lib/format";

/**
 * Rename a CAMPAIGN (2026-11). Its ad sets carry its name inside their own
 * stored names, so the one edit renames all of them — the dialog says how
 * many, and that the names uploads must match change with it. The page then
 * follows the campaign's new address.
 */
export function ParentCampaignEditDialog({
  id,
  name: initName,
  adSetCount,
}: {
  id: string;
  name: string;
  adSetCount: number;
}) {
  const router = useRouter();
  const canEdit = useCan("campaign.edit");
  const [open, setOpen] = useState(false);
  const fid = useId();
  const [name, setName] = useState(initName);
  const [pending, start] = useTransition();
  // Navigations show the progress bar (W3-6).
  const [, startNav] = useNavTransition();
  const [error, setError] = useState<string | null>(null);

  const badSeparator = campaignNameHasSeparator(name);
  const dirty = name.trim() !== initName;
  const ready = name.trim() !== "" && !badSeparator;

  const onOpenChange = (next: boolean) => {
    if (pending) return; // don't allow closing mid-save
    if (next) {
      setName(initName);
      setError(null);
    }
    setOpen(next);
  };

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!ready || !dirty) return;
    setError(null);
    start(async () => {
      const res = await safeAction(() => updateParentCampaign({ id, name }));
      if (res.ok && res.name && res.network) {
        toast.success("Campaign renamed");
        setOpen(false);
        // ONE render (W2-1): the address changed with the name, and the action
        // does not revalidate — the navigation is the render.
        await actionSettled();
        const href = campaignPath(res.network, res.name);
        startNav(() => router.push(href));
      } else {
        toastActionFailure(res, "Couldn't rename the campaign", { inline: setError });
      }
    });
  };

  if (!canEdit) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="w-3.5 h-3.5" /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Rename campaign</DialogTitle>
          <DialogDescription>
            {adSetCount > 0 ? (
              <>
                Renames its {int(adSetCount)} ad set{adSetCount === 1 ? "" : "s"} too. Existing
                performance keeps its link, but future uploads must match the new names, and old
                links to those ad sets stop working — rename your source the same way.
              </>
            ) : (
              <>Future uploads must match the new name — rename your source the same way.</>
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          {/* `pb-2`: the sticky DialogFooter rides 8px up over whatever sits
              above it inside a form — here, the input's lower edge. */}
          <div className="space-y-4 pb-2">
            <Field
              label="Campaign name"
              htmlFor={`${fid}-name`}
              error={badSeparator ? "A campaign name can’t contain ➤" : null}
            >
              <Input
                id={`${fid}-name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                dir="auto"
              />
            </Field>

            <FormError>{error}</FormError>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !ready || !dirty}>
              {pending ? "Saving…" : "Rename"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
