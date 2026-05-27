"use client";

import { useTransition } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
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
          const res = await removeHeaderMapping(id);
          if (!res.ok) {
            toast.error(res.error ?? "Could not remove");
          } else {
            toast.success("Mapping removed");
          }
        })
      }
      className="text-ink-3 hover:text-neg w-6 h-6 p-0"
      aria-label="Remove"
    >
      <X className="w-3 h-3" />
    </Button>
  );
}
