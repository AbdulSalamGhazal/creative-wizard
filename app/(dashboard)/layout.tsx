import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { creatives, products } from "@/db/schema";
import { eq } from "drizzle-orm";

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
  const creativeOptions = await db
    .select({
      id: creatives.id,
      name: creatives.name,
      productName: products.name,
    })
    .from(creatives)
    .innerJoin(products, eq(products.id, creatives.productId))
    .orderBy(asc(creatives.name))
    .limit(500);

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar user={user} creatives={creativeOptions} />
      <div className="flex flex-1">
        <Sidebar role={user.role} />
        <div className="flex-1 flex flex-col">
          <main className="flex-1 px-6 py-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
