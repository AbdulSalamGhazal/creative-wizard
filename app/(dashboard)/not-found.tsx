import { PageShell } from "@/components/layout/page-shell";
import { InAppNotFound } from "@/components/layout/in-app-not-found";

export const metadata = { title: "Not found" };

/**
 * A `notFound()` from any page in the app renders HERE, inside the dashboard
 * layout — sidebar, top bar, brand switcher and search intact (R-047). The
 * root `app/not-found.tsx` stays for unknown top-level URLs.
 */
export default function DashboardNotFound() {
  return (
    <PageShell>
      <InAppNotFound />
    </PageShell>
  );
}
