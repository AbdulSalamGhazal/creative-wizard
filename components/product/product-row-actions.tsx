"use client";

import { useTransition } from "react";
import { Archive, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { archiveProduct, restoreProduct } from "@/app/actions/product";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";

export function ProductRowActions({
  productId,
  status,
}: {
  productId: string;
  status: "active" | "archived";
}) {
  const [isPending, startTransition] = useTransition();

  const run = (
    fn: () => Promise<{ ok: boolean; error?: string; stale?: boolean }>,
    successMessage: string,
    errorMessage: string,
  ) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        toastActionFailure(r, errorMessage);
        return;
      }
      toast.success(successMessage);
    });

  if (status === "archived") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() =>
          run(() => safeAction(() => restoreProduct(productId)), "Product restored", "Could not restore")
        }
        disabled={isPending}
        className="text-ink-3 hover:text-ink"
      >
        <RotateCcw className="w-3 h-3" />
        Restore
      </Button>
    );
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={() =>
        run(() => safeAction(() => archiveProduct(productId)), "Product archived", "Could not archive")
      }
      disabled={isPending}
      className="text-ink-3 hover:text-warn"
    >
      <Archive className="w-3 h-3" />
      Archive
    </Button>
  );
}
