import { redirect } from "next/navigation";
import { auth, can } from "@/lib/auth";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { StoreUploadPanel } from "@/components/store/store-upload-panel";

export const metadata = { title: "New order upload" };

/**
 * The store upload flow (dropzone → validate → error report / summary →
 * confirm). Mirrors /uploads/new for performance data. On a successful commit
 * it lands back on /store/uploads with the new batch in the history.
 */
export default async function NewStoreUploadPage() {
  const user = await auth();
  if (!user || !can(user, "store.upload")) redirect("/store/uploads");

  return (
    <PageShell width="import">
      <PageHeader
        eyebrow="Store"
        backLink={{ href: "/store/uploads", label: "Back to order uploads" }}
        title="New order upload"
        subtitle="Every file is validated first — nothing is imported unless all rows check out. Amounts are in SAR."
      />

      <StoreUploadPanel redirectOnCommit="/store/uploads" />
    </PageShell>
  );
}
