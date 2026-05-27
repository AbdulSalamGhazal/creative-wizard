"use client";

import { useTransition } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { removeHeaderMapping } from "@/app/actions/platform-mapping";

export function MappingRemoveButton({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await removeHeaderMapping(id);
        })
      }
      className="text-ink-3 hover:text-neg w-6 h-6 p-0"
      aria-label="Remove"
    >
      <X className="w-3 h-3" />
    </Button>
  );
}
