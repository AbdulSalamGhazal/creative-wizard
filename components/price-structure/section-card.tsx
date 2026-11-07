import type { ReactNode } from "react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { InfoTip } from "@/components/ui/info-tip";

/**
 * The module's card: a title (with an optional ⓘ), an optional one-line
 * subtitle, and an actions slot top-right — shadcn's Card parts in the one
 * arrangement every Price Structure card uses.
 *
 * Show, don't label (R-058): `subtitle` is ONE FACT ("SAR per delivered
 * order", "{period}, whole period"); a sentence that explains how to read the
 * card is `info` — an InfoTip beside the title, as PageHeader does.
 */
export function SectionCard({
  id,
  title,
  subtitle,
  info,
  actions,
  children,
  className,
  contentClassName,
}: {
  id?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** How to read the card — an ⓘ beside the title, never body copy. */
  info?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card id={id} className={cn("gap-3", className)}>
      <CardHeader>
        <CardTitle className="col-start-1 row-start-1 text-sm font-medium">
          {info ? (
            <span className="inline-flex items-center gap-1.5">
              {title}
              <InfoTip label="About this card">{info}</InfoTip>
            </span>
          ) : (
            title
          )}
        </CardTitle>
        {subtitle && <CardDescription className="col-start-1 row-start-2 text-xs text-ink-3">{subtitle}</CardDescription>}
        {/* In a narrow card (a phone, or one of two columns) the actions drop
            under the title as a full-width row instead of squeezing it. */}
        {actions && (
          <CardAction className="flex flex-wrap items-center justify-end gap-2 @max-[30rem]/card-header:col-span-2 @max-[30rem]/card-header:row-span-1 @max-[30rem]/card-header:row-start-3 @max-[30rem]/card-header:w-full @max-[30rem]/card-header:justify-start">
            {actions}
          </CardAction>
        )}
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  );
}
