import {
  CAMPAIGN_STATUS_DOT,
  CAMPAIGN_STATUS_LABEL,
  type CampaignStatus,
} from "@/lib/campaign-status";
import { StatusDot } from "@/components/ui/status-dot";

/**
 * A campaign's dynamic Active/Inactive status — the shared `StatusDot`, so it
 * reads exactly like a creative's status (green = running within the window,
 * gray = not). Pure render — safe on server or client (the campaigns table +
 * the detail header both use it).
 */
export function CampaignStatusBadge({
  status,
  className,
}: {
  status: CampaignStatus;
  className?: string;
}) {
  return (
    <StatusDot
      color={CAMPAIGN_STATUS_DOT[status]}
      label={CAMPAIGN_STATUS_LABEL[status]}
      className={className}
    />
  );
}
