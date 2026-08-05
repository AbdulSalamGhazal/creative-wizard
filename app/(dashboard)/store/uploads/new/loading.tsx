import { HeaderSkeleton } from "@/components/layout/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function NewStoreUploadLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <HeaderSkeleton eyebrow subtitle back />
      <Skeleton className="h-48 w-full rounded-lg" />
    </div>
  );
}
