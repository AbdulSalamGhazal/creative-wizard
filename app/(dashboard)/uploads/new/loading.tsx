import { PageShell } from "@/components/layout/page-shell";
import { HeaderSkeleton, DropzoneSkeleton } from "@/components/layout/page-skeletons";

export default function NewUploadLoading() {
  return (
    <PageShell width="import">
      <HeaderSkeleton back />
      <DropzoneSkeleton options />
    </PageShell>
  );
}
