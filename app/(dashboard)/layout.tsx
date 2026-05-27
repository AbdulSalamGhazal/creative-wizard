import { Suspense } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { FilterStrip } from "@/components/filters/filter-strip";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <TopBar />
      <div className="flex flex-1">
        <Sidebar />
        <div className="flex-1 flex flex-col">
          <Suspense
            fallback={
              <div className="sticky top-0 z-10 border-b border-line bg-background/95 backdrop-blur h-12" />
            }
          >
            <FilterStrip />
          </Suspense>
          <main className="flex-1 px-6 py-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
