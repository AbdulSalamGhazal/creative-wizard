import { UploadForm } from "@/components/upload/upload-form";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";

export default function NewUploadPage() {
  return (
    <PageShell width="import">
      <PageHeader
        backLink={{ href: "/uploads", label: "Back to upload history" }}
        title="New upload"
        subtitle="Every file is validated first — nothing is imported unless all rows check out."
      />

      <UploadForm />
    </PageShell>
  );
}
