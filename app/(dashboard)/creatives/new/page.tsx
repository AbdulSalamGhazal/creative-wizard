import { redirect } from "next/navigation";
import { listProducts } from "@/db/queries/products";
import { listAllAngles } from "@/db/queries/creatives";
import { auth, can } from "@/lib/auth";
import { CreativeCreateForm } from "@/components/creative/creative-create-form";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";

export const metadata = { title: "New creative" };

export default async function NewCreativePage() {
  const user = await auth();
  if (!user || !can(user, "creative.create")) redirect("/creatives");
  const [products, allAngles] = await Promise.all([listProducts(), listAllAngles()]);

  return (
    <PageShell width="form">
      <PageHeader
        backLink={{ href: "/creatives", label: "Back to library" }}
        title="New creative"
        subtitle="Names are case- and whitespace-sensitive — match your ad platform exactly so performance rows import cleanly."
      />

      <CreativeCreateForm products={products} allAngles={allAngles} />
    </PageShell>
  );
}
