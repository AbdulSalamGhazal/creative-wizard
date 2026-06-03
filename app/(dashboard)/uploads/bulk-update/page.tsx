import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BulkUpdateForm } from "@/components/upload/bulk-update-form";

export default function BulkUpdatePage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <Link
          href="/uploads"
          className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink transition-colors"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to upload history
        </Link>
        <h1 className="font-display text-4xl tracking-tight mt-3">Bulk update</h1>
        <p className="text-ink-2 text-sm mt-1">
          Correct existing records from a CSV/XLSX. Rows are matched on{" "}
          <span className="text-ink">creative · platform · campaign ➤ adset · date</span>{" "}
          — only matched rows update, and only the value columns you include
          (e.g. just Spend) are overwritten. Nothing is created; you preview
          every change before it&rsquo;s applied.
        </p>
      </div>

      <BulkUpdateForm />
    </div>
  );
}
