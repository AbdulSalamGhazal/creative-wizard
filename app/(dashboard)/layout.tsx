import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { NavProgressBar } from "@/components/layout/nav-progress-bar";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { creatives, products } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getActiveAccountId, listAccounts } from "@/lib/tenant";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await auth();
  if (!user) {
    redirect("/signin");
  }

  // One small query feeds the ⌘K palette; capped at 500 names which is
  // more than enough for the team's catalog (and keeps the client bundle
  // shape predictable).
  const [acct, accounts] = await Promise.all([
    getActiveAccountId(),
    listAccounts(),
  ]);
  const creativeOptions = await db
    .select({
      id: creatives.id,
      name: creatives.name,
      productName: products.name,
    })
    .from(creatives)
    .innerJoin(products, eq(products.id, creatives.productId))
    .where(eq(creatives.accountId, acct))
    .orderBy(asc(creatives.name))
    .limit(500);

  return (
    <div className="min-h-screen flex flex-col">
      <NavProgressBar />
      <TopBar
        user={user}
        creatives={creativeOptions}
        accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
        activeAccountId={acct}
      />
      <div className="flex flex-1">
        <Sidebar role={user.role} />
        {/* `min-w-0` lets this column shrink to the available width instead
         *  of being forced to its content's intrinsic width — so wide
         *  children (e.g. the Summary table) scroll within their own
         *  overflow-x container rather than pushing the whole page to
         *  scroll horizontally. */}
        <div className="flex-1 min-w-0 flex flex-col">
          <main className="flex-1 px-6 py-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
