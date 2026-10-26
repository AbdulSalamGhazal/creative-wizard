import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { listActivity } from "@/db/queries/activity";
import { activityParamsSchema } from "@/validators/activity";
import { utcDay } from "@/lib/notifications";
import { ActivityFeed, ActivityWhoSwitch } from "@/components/activity/activity-feed";

export const dynamic = "force-dynamic";

export const metadata = { title: "Activity" };

/**
 * Every comment in the brand, newest first (2026-10). No sidebar entry — the
 * bell's footer and the comment panel are the ways in — and no permission:
 * comment reads are brand-scoped, and the query hides the few pages that
 * would refuse the viewer.
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Every field falls back rather than throws (validators/activity.ts).
  const params = activityParamsSchema.parse(await searchParams);
  const data = await listActivity(params);

  return (
    <PageShell width="admin">
      <PageHeader title="Activity" rightSlot={<ActivityWhoSwitch params={params} />} />
      <ActivityFeed
        params={params}
        rows={data.rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        // The day headers' clock, resolved on the SERVER in UTC — the same
        // clock the groups are bucketed by (W1-13).
        today={utcDay(new Date())}
      />
    </PageShell>
  );
}
