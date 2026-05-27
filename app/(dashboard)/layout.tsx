import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { auth } from "@/lib/auth";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await auth();
  if (!user) {
    redirect("/signin");
  }

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar user={user} />
      <div className="flex flex-1">
        <Sidebar role={user.role} />
        <div className="flex-1 flex flex-col">
          <main className="flex-1 px-6 py-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
