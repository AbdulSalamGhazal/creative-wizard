import {
  CAMPAIGN_STATUS_DOT,
  CAMPAIGN_STATUS_LABEL,
  type CampaignStatus,
} from "@/lib/campaign-status";
import { cn } from "@/lib/utils";

/**
 * Compact dot + label for a campaign's dynamic Active/Inactive status. Green dot
 * = running within the window, gray = not. Pure render — safe on server or
 * client (the campaigns table + the detail header both use it).
 */
export function CampaignStatusBadge({
  status,
  className,
}: {
  status: CampaignStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap text-xs",
        className,
      )}
    >
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ background: CAMPAIGN_STATUS_DOT[status] }}
      />
      <span className={status === "active" ? "text-ink" : "text-ink-3"}>
        {CAMPAIGN_STATUS_LABEL[status]}
      </span>
    </span>
  );
}
