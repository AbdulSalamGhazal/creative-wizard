"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/lib/brand-nav";
import { useNavTransition } from "@/lib/nav-progress";
import { actionSettled } from "@/lib/router-queue";
import {
  LandingPageDialog,
  type ProductOption,
} from "@/components/landing-page/landing-page-dialog";
import type { LandingPageRow } from "@/db/queries/landing-pages";

/**
 * The landing page detail page's Edit — the Library registry's own dialog.
 * The page renders this only for a holder of `catalog.landing_pages` (the
 * server action checks it again). ONE render per action: an edit that keeps
 * the code arrives re-rendered in the action's response; a changed code (only
 * possible while no record uses the page) follows the page to its new address
 * once the action has settled.
 */
export function LandingPageEditButton({
  row,
  products,
}: {
  row: LandingPageRow;
  products: ProductOption[];
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [, startNav] = useNavTransition();

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="w-3.5 h-3.5" /> Edit
      </Button>
      {open && (
        <LandingPageDialog
          editing={{ mode: "edit", row }}
          products={products}
          onClose={() => setOpen(false)}
          onSaved={async (code) => {
            if (code === row.code) return;
            await actionSettled();
            startNav(() => router.replace(`/landing-pages/${encodeURIComponent(code)}`));
          }}
        />
      )}
    </>
  );
}
