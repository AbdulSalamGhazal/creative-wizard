"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
 * `setActiveAccount`, then refreshes so every server component re-reads under
 * the new account. A view preference, not a security boundary — any signed-in
 * user may switch to any brand.
 */
export function AccountSwitcher({ accounts, activeId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const active = accounts.find((a) => a.id === activeId) ?? accounts[0];
  if (!active) return null;

  function switchTo(id: string) {
    if (id === activeId) return;
    startTransition(async () => {
      const res = await setActiveAccount({ accountId: id });
      if (!res.ok) {
        toast.error(res.error ?? "Could not switch brand");
        return;
      }
      const name = accounts.find((a) => a.id === id)?.name ?? "brand";
      router.refresh();
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
          className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs font-medium text-ink-2 hover:text-ink hover:bg-surface-2 transition"
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
