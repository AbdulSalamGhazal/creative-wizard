"use client";

import { useState, useTransition } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setActiveAccount } from "@/app/actions/account";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";

interface Account {
  id: string;
  name: string;
}

interface Props {
  accounts: Account[];
  activeId: string;
}

/**
 * Brand (account) switcher in the top bar, right of the "WIZARD"
 * title. Selecting a brand writes the `ccms_account` cookie via
 * `setActiveAccount`, whose `revalidatePath("/", "layout")` re-renders the
 * whole page under the new brand IN the action's response — ONE render (P-15,
 * 2026-10: a `router.refresh()` here used to fetch the same tree a second
 * time). Membership is checked server-side; only allowed brands are listed.
 */
export function AccountSwitcher({ accounts, activeId }: Props) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const active = accounts.find((a) => a.id === activeId) ?? accounts[0];
  if (!active) return null;

  function switchTo(id: string) {
    if (id === activeId) return;
    startTransition(async () => {
      const res = await safeAction(() => setActiveAccount({ accountId: id }));
      if (!res.ok) {
        toastActionFailure(res, "Could not switch brand");
        return;
      }
      const name = accounts.find((a) => a.id === id)?.name ?? "brand";
      toast.success(`Switched to ${name}`);
    });
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Switch brand"
          aria-label="Switch brand"
          // `min-w-0` lets the trigger shrink when the top bar runs out of
          // room: the brand NAME truncates instead of the bar overflowing.
          className="flex min-w-0 items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs font-medium text-ink-2 hover:text-ink hover:bg-surface-2 transition"
        >
          <span className="max-w-[140px] truncate">{active.name}</span>
          {pending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          ) : (
            <ChevronsUpDown className="w-3.5 h-3.5 shrink-0 opacity-60" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 max-h-[60vh] overflow-y-auto">
        <DropdownMenuLabel>Brand</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {accounts.map((a) => (
          <DropdownMenuItem
            key={a.id}
            onSelect={(e) => {
              e.preventDefault();
              switchTo(a.id);
              setOpen(false);
            }}
            className="gap-2"
          >
            <Check
              className={
                a.id === activeId
                  ? "w-4 h-4 shrink-0"
                  : "w-4 h-4 shrink-0 opacity-0"
              }
            />
            <span className="truncate">{a.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
