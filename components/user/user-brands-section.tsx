"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { updateUserBrands } from "@/app/actions/user";
import { useNavTransition } from "@/lib/nav-progress";

export interface BrandOption {
  id: string;
  name: string;
}

/**
 * The "Brands" section of a user's access card — WHERE they can work (the
 * counterpart to the permission grid's WHAT). An "All brands" toggle; when off,
 * one checkbox per brand. Admins are forced to all-brands (disabled, with the
 * same explanatory-note style as the forced permission rows). Own card is
 * read-only (no self-edit). Its own dirty-check + Save, calling
 * `updateUserBrands` — independent of the role/permissions save above.
 */
export function UserBrandsSection({
  userId,
  isSelf,
  isAdmin,
  brands,
  initialAllAccounts,
  initialAccountIds,
}: {
  userId: string;
  isSelf: boolean;
  /** Target user's saved role is admin → forced all-brands. */
  isAdmin: boolean;
  brands: BrandOption[];
  initialAllAccounts: boolean;
  initialAccountIds: string[];
}) {
  const router = useRouter();
  const [allAccounts, setAllAccounts] = useState(initialAllAccounts);
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(initialAccountIds),
  );
  const [isPending, startTransition] = useNavTransition();

  const locked = isSelf || isAdmin;

  const initialSorted = useMemo(
    () => [...initialAccountIds].sort(),
    [initialAccountIds],
  );
  const dirty =
    !locked &&
    (allAccounts !== initialAllAccounts ||
      (!allAccounts &&
        JSON.stringify([...checked].sort()) !== JSON.stringify(initialSorted)));

  const noneChosen = !allAccounts && checked.size === 0;

  function toggle(id: string) {
    if (locked || allAccounts) return;
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function discard() {
    setAllAccounts(initialAllAccounts);
    setChecked(new Set(initialAccountIds));
  }

  function save() {
    if (noneChosen) return;
    startTransition(async () => {
      const res = await updateUserBrands({
        userId,
        allAccounts,
        accountIds: allAccounts ? [] : [...checked],
      });
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't save brand access");
        return;
      }
      toast.success("Updated brand access");
      router.refresh();
    });
  }

  return (
    <div className="border-t border-line px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-label text-ink-3">Brands</div>
        {!locked && (
          <button
            type="button"
            role="switch"
            aria-checked={allAccounts}
            onClick={() => setAllAccounts((v) => !v)}
            className="flex items-center gap-2 text-xs text-ink-2 hover:text-ink"
          >
            <span
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                allAccounts
                  ? "border-transparent bg-[var(--brand)] text-[var(--primary-foreground)]"
                  : "border-line",
              )}
              aria-hidden
            >
              {allAccounts && <Check className="h-3 w-3" strokeWidth={3} />}
            </span>
            All brands
          </button>
        )}
      </div>

      {isAdmin ? (
        <p className="text-xs text-ink-3">
          Admins can always see every brand.
        </p>
      ) : allAccounts ? (
        <p className="text-xs text-ink-3">
          Member of every brand, including brands created later.
        </p>
      ) : (
        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {brands.map((b) => {
            const on = checked.has(b.id);
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => toggle(b.id)}
                disabled={locked}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors",
                  locked ? "cursor-default" : "hover:bg-surface-2",
                )}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    on
                      ? "border-transparent bg-[var(--brand)] text-[var(--primary-foreground)]"
                      : "border-line",
                  )}
                  aria-hidden
                >
                  {on && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span className={cn("truncate text-ink-2", on && "text-ink")}>
                  {b.name}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {noneChosen && (
        <p className="mt-2 text-xs text-neg">Select at least one brand.</p>
      )}

      {dirty && (
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={discard}
            disabled={isPending}
          >
            Discard
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={save}
            disabled={isPending || noneChosen}
          >
            {isPending ? "Saving…" : "Save brands"}
          </Button>
        </div>
      )}
    </div>
  );
}
