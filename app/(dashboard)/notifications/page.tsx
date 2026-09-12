import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import { listNotifications, type NotificationTab } from "@/db/queries/notifications";
import { isNotificationCategory } from "@/lib/notifications";
import { NotificationCenter } from "@/components/notifications/notification-center";

export const dynamic = "force-dynamic";

export const metadata = { title: "Notifications" };

const TABS: NotificationTab[] = ["all", "unread", "archived"];

/**
 * Everything the signed-in user has been told, in this brand. There is no
 * sidebar entry — the bell is the way in — and no permission: the rows are
 * yours, and the query layer scopes every read to you.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    categories?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const tab: NotificationTab = TABS.includes(sp.tab as NotificationTab)
    ? (sp.tab as NotificationTab)
    : "all";
  const categories = (sp.categories ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter((c) => isNotificationCategory(c));
  const q = sp.q?.trim() ?? "";
  const page = Number(sp.page ?? "1");

  const data = await listNotifications({
    tab,
    categories,
    q,
    page: Number.isFinite(page) ? page : 1,
  });

  return (
    <PageShell width="admin">
      <PageHeader
        title="Notifications"
        subtitle="What happened in this brand while you were elsewhere. Clearing archives — nothing here is ever deleted."
      />
      <NotificationCenter
        tab={tab}
        categories={categories}
        q={q}
        rows={data.rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        unread={data.unread}
      />
    </PageShell>
  );
}
