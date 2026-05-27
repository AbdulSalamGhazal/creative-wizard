"use client";

import { useTransition } from "react";
import { Archive, RotateCcw } from "lucide-react";
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

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) console.error(r.error);
    });

  if (status === "archived") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => run(() => restoreProduct(productId))}
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
      onClick={() => run(() => archiveProduct(productId))}
      disabled={isPending}
      className="text-ink-3 hover:text-warn"
    >
      <Archive className="w-3 h-3" />
      Archive
    </Button>
  );
}
