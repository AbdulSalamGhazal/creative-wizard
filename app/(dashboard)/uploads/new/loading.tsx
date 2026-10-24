import { HeaderSkeleton, DropzoneSkeleton } from "@/components/layout/page-skeletons";

export default function NewUploadLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <HeaderSkeleton back />
      <DropzoneSkeleton options />
    </div>
  );
}
