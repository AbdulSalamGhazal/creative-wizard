"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
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

const FIELDS = [
  { value: "creative_name", label: "Creative name" },
  { value: "date", label: "Date" },
  { value: "spend", label: "Spend" },
  { value: "impressions", label: "Impressions" },
  { value: "clicks", label: "Clicks" },
  { value: "conversions", label: "Conversions" },
  { value: "conversion_value", label: "Conversion value" },
  { value: "video_views_3s", label: "Video views 3s" },
  { value: "video_views_15s", label: "Video views 15s" },
] as const;

type Field = (typeof FIELDS)[number]["value"];

export function MappingAddForm({
  platform,
}: {
  platform: "meta" | "tiktok" | "snapchat" | "google";
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
        return;
      }
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
            {FIELDS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
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
