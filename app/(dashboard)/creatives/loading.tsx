import { Skeleton } from "@/components/ui/skeleton";

export default function CreativesLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-10 w-80" />
          <Skeleton className="h-3 w-56" />
        </div>
        <Skeleton className="h-9 w-36 rounded-md" />
      </div>
      <Skeleton className="h-12 w-full rounded-md" />
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg border border-line bg-surface overflow-hidden"
          >
            <Skeleton className="aspect-[4/3] w-full rounded-none" />
            <div className="p-3 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
