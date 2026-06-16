import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { UploadForm } from "@/components/upload/upload-form";

export default function NewUploadPage() {
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
        <h1 className="font-display text-4xl tracking-tight mt-3">
          New upload
        </h1>
        <p className="text-ink-2 text-sm mt-1">
          Every file is validated first — nothing is imported unless all rows
          check out.
        </p>
      </div>

      <UploadForm />
    </div>
  );
}
