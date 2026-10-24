import { HeaderSkeleton, FormSkeleton } from "@/components/layout/page-skeletons";

export default function NewCampaignLoading() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <HeaderSkeleton back />
      <FormSkeleton fields={4} card />
    </div>
  );
}
