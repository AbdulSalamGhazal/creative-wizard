"use client";

import { useTransition } from "react";
import { Archive, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { archiveProduct, restoreProduct } from "@/app/actions/product";

export function ProductRowActions({
  productId,
  status,
}: {
  productId: string;
  status: "active" | "archived";
}) {
  const [isPending, startTransition] = useTransition();

  const run = (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    successMessage: string,
    errorMessage: string,
  ) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        toast.error(r.error ?? errorMessage);
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
          run(() => restoreProduct(productId), "Product restored", "Could not restore")
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
        run(() => archiveProduct(productId), "Product archived", "Could not archive")
      }
      disabled={isPending}
      className="text-ink-3 hover:text-warn"
    >
      <Archive className="w-3 h-3" />
      Archive
    </Button>
  );
}
