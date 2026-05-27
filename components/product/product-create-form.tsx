"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createProduct } from "@/app/actions/product";

export function ProductCreateForm() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createProduct({ name: name.trim() });
      if (!res.ok) {
        setError(res.fieldErrors?.name ?? res.error ?? "Failed");
        return;
      }
      setName("");
    });
  };

  return (
    <form onSubmit={submit} className="flex items-start gap-2">
      <div className="flex-1">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New product name"
          maxLength={255}
          required
        />
        {error && <p className="mt-1 text-[11px] text-neg">{error}</p>}
      </div>
      <Button type="submit" disabled={isPending || !name.trim()}>
        <Plus className="w-4 h-4" />
        {isPending ? "Adding…" : "Add product"}
      </Button>
    </form>
  );
}
