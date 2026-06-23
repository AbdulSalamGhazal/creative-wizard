import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CampaignCreateForm } from "@/components/campaign/campaign-create-form";

export default function NewCampaignPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <Link
          href="/campaigns"
          className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink transition-colors"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to campaigns
        </Link>
        <h1 className="font-display text-4xl tracking-tight mt-3">New campaign</h1>
        <p className="text-ink-2 text-sm mt-1">
          Register a campaign before its first upload. The stored name is built
          from Campaign + Ad Set + Platform (matching your ad-platform export),
          so uploads line up exactly. Pick a platform and objective deliberately.
        </p>
      </div>

      <CampaignCreateForm />
    </div>
  );
}
