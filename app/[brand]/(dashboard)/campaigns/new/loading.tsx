import { PageShell } from "@/components/layout/page-shell";
import { HeaderSkeleton, FormSkeleton } from "@/components/layout/page-skeletons";

export default function NewCampaignLoading() {
  return (
    <PageShell width="form">
      <HeaderSkeleton back />
      <FormSkeleton fields={4} card />
    </PageShell>
  );
}
