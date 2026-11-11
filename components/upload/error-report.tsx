"use client";

import type { ReactNode } from "react";
import Link from "@/components/nav/link";
import { Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ValidationReport } from "@/components/upload/validation-report";
import { useCan } from "@/components/auth/permissions-context";
import { downloadCsv, rowsToCsv } from "@/lib/csv-export";
import type { ReportGroup } from "@/lib/validation-report";
import type { ValidationError } from "@/csv/errors";

interface Props {
  errors: ValidationError[];
  warnings: ValidationError[];
}

/** The bulk import's own columns (bulk-creative-import's template). */
const BULK_TEMPLATE_COLUMNS = ["name", "product", "type", "launch_date", "angles"] as const;

/**
 * The ads upload's validation report: the shared `ValidationReport` plus the
 * way out of the commonest failures (R-062). Most of them are fixed in the
 * app, not the file — an ad name, a campaign or a landing page that isn't
 * registered yet — so each such problem links to the page that registers it.
 * Links open in a new tab: this one keeps the chosen file, so "Try again"
 * re-validates it once the thing is registered.
 */
export function ErrorReport({ errors, warnings }: Props) {
  const canCreateCreative = useCan("creative.create");
  const canCreateCampaign = useCan("campaign.create");
  const canLandingPages = useCan("catalog.landing_pages");

  // Every unregistered creative name, once — the bulk import takes them all.
  const missingNames = [
    ...new Set(
      errors.filter((e) => e.code === "E020" && e.value).map((e) => e.value!),
    ),
  ];

  const downloadTemplate = () => {
    const csv = rowsToCsv(
      missingNames,
      BULK_TEMPLATE_COLUMNS.map((c) => ({
        key: c,
        label: c,
        value: (name: string) => (c === "name" ? name : null),
      })),
    );
    downloadCsv("unregistered-creatives.csv", csv);
  };

  const fix = (g: ReportGroup<ValidationError>) => {
    if (g.code === "E020" && canCreateCreative) {
      return <FixLink href="/library/new">Register</FixLink>;
    }
    if (g.code === "E061" && canCreateCampaign) {
      return <FixLink href="/campaigns/new">Create campaign</FixLink>;
    }
    if (g.code === "E023" && canLandingPages) {
      return <FixLink href="/library?tab=landing-pages">Add landing page</FixLink>;
    }
    return null;
  };

  return (
    <ValidationReport
      errors={errors}
      warnings={warnings}
      fix={fix}
      actions={
        missingNames.length > 1 && canCreateCreative ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={downloadTemplate}
              className="text-ink-3 hover:text-ink"
              title="The unregistered names in the Bulk import template — add each one's product, then import it"
            >
              <Download className="w-3 h-3" />
              {missingNames.length} names as import file
            </Button>
            <FixLink href="/library/bulk">Bulk import</FixLink>
          </>
        ) : null
      }
      footer="Fix the file, or register what’s missing (links open in a new tab), then Try again."
    />
  );
}

function FixLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button asChild variant="ghost" size="xs" className="text-brand hover:text-brand">
      <Link href={href} target="_blank" rel="noopener">
        {children}
        <ExternalLink className="w-3 h-3" />
      </Link>
    </Button>
  );
}
