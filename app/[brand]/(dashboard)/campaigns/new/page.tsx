import { brandRedirect } from "@/lib/brand-redirect";
import { auth, can } from "@/lib/auth";
import { CampaignCreateForm } from "@/components/campaign/campaign-create-form";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";

export const metadata = { title: "New campaign" };

export default async function NewCampaignPage() {
  const user = await auth();
  if (!user || !can(user, "campaign.create")) return brandRedirect("/campaigns");
  return (
    <PageShell width="form">
      <PageHeader
        backLink={{ href: "/campaigns", label: "Back to Campaigns" }}
        title="New campaign"
        info="A campaign and its ad sets are registered together. Each ad set is stored as Campaign ➤ Ad set (matching your ad-platform export), so uploads line up exactly."
      />

      <CampaignCreateForm />
    </PageShell>
  );
}
