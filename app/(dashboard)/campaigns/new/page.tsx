import { CampaignCreateForm } from "@/components/campaign/campaign-create-form";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";

export default function NewCampaignPage() {
  return (
    <PageShell width="form">
      <PageHeader
        backLink={{ href: "/campaigns", label: "Back to campaigns" }}
        title="New campaign"
        subtitle="Register a campaign before its first upload. The stored name is built from Campaign + Ad Set + Platform (matching your ad-platform export), so uploads line up exactly. Pick a platform and objective deliberately."
      />

      <CampaignCreateForm />
    </PageShell>
  );
}
