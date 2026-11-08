import type { ReactNode } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { VersionBar } from "./version-bar";

/**
 * Every Price Structure page's header: the eyebrow names the module, the
 * title names the page, the brief's intro sentence sits behind the ⓘ ("show,
 * don't label"), and the version picker / Settings / save status fill the
 * right slot.
 */
export function PsPageHeader({ title, info, children }: { title: string; info?: ReactNode; children?: ReactNode }) {
  return (
    <PageHeader eyebrow="Pricing" title={title} info={info} rightSlot={<VersionBar />}>
      {children}
    </PageHeader>
  );
}
