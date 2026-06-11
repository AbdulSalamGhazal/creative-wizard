"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addHeaderMapping } from "@/app/actions/platform-mapping";
import { FIELD_LIST, type InternalField } from "@/csv/platforms/types";

type Field = InternalField;

export function MappingAddForm({
  platform,
}: {
  platform: "instagram" | "facebook" | "tiktok" | "snapchat";
}) {
  const [field, setField] = useState<Field>("creative_name");
  const [headerName, setHeaderName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const trimmed = headerName.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const res = await addHeaderMapping({
        platform,
        internalField: field,
        headerName: trimmed,
      });
      if (!res.ok) {
        setError(res.error ?? "Failed");
        toast.error(res.error ?? "Could not add mapping");
        return;
      }
      toast.success(`Added "${trimmed}"`);
      setHeaderName("");
    });
  };

  return (
    <form
      onSubmit={submit}
      className="grid grid-cols-1 md:grid-cols-[180px_1fr_auto] gap-2 items-end"
    >
      <div>
        <Select value={field} onValueChange={(v) => setField(v as Field)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FIELD_LIST.map((f) => (
              <SelectItem key={f.key} value={f.key}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Input
        value={headerName}
        onChange={(e) => setHeaderName(e.target.value)}
        placeholder='Header from your CSV, e.g. "Amount spent (USD)"'
        maxLength={255}
      />
      <Button type="submit" disabled={isPending || !headerName.trim()}>
        <Plus className="w-4 h-4" />
        Add
      </Button>
      {error && (
        <p className="md:col-span-3 text-[11px] text-neg">{error}</p>
      )}
    </form>
  );
}
