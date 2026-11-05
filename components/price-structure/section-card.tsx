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

/**
 * The module's card: a title, an optional one-line subtitle (a FACT or the
 * brief's own sentence), and an actions slot top-right — shadcn's Card parts
 * in the one arrangement every Price Structure card uses.
 */
export function SectionCard({
  id,
  title,
  subtitle,
  actions,
  children,
  className,
  contentClassName,
}: {
  id?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card id={id} className={cn("gap-3", className)}>
      <CardHeader>
        <CardTitle className="col-start-1 row-start-1 text-sm font-medium">{title}</CardTitle>
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
