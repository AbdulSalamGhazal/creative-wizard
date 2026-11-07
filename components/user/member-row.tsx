"use client";

import { KeyRound, LogOut, MoreHorizontal, Settings2, UserCheck, UserMinus, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/user/user-avatar";
import { cn } from "@/lib/utils";
import { dateTimeLabel, isoDate, relativeTime } from "@/lib/format";
import { PRESET_LABEL, presetOf } from "@/lib/team-presets";
import { memberStatus } from "@/lib/team-lifecycle";
import type { MemberDialog, TeamMember } from "@/lib/team-member";
import type { BrandOption } from "@/components/user/user-brands-section";
import { teamGuard, type ManagerScope, type MemberAccess } from "@/lib/team-guard";
import { Chip } from "@/components/ui/chip";

/** Which lifecycle actions the guard lets this manager take on this member. */
export function memberAbilities(member: TeamMember, isSelf: boolean, scope: ManagerScope) {
  const target: MemberAccess = {
    role: member.role,
    permissions: member.permissions,
    allAccounts: member.allAccounts,
    accountIds: member.accountIds,
  };
  const ok = (change: Parameters<typeof teamGuard>[1]) => teamGuard(scope, change) === null;
  return {
    password: ok({ kind: "password", target }),
    sessions: !isSelf && ok({ kind: "sessions", target }),
    status: !isSelf && ok({ kind: "status", target }),
    remove: !isSelf && ok({ kind: "remove", target }),
  };
}

/** "All brands" or the brand names, for the row and the drawer header. */
export function brandsSummary(member: TeamMember, brands: BrandOption[]): string {
  if (member.role === "admin" || member.allAccounts) return "All brands";
  const names = brands.filter((b) => member.accountIds.includes(b.id)).map((b) => b.name);
  return names.length === 0 ? "No brands" : names.join(", ");
}

/**
 * One member of the Team page (D4, 2026-11-06): who they are, what they are
 * (the preset badge), where (brands), when they were last in, and the ⋯ menu
 * of everything the guard allows. The row itself opens the drawer. A list
 * row rather than a `DataTable`: a directory of people has five short facts
 * and no sorting, totals or export to offer, and it must stack on a phone.
 */
export function MemberRow({
  member,
  isSelf,
  brands,
  scope,
  onOpen,
  onDialog,
}: {
  member: TeamMember;
  isSelf: boolean;
  brands: BrandOption[];
  scope: ManagerScope;
  onOpen: (id: string) => void;
  onDialog: (dialog: MemberDialog, member: TeamMember) => void;
}) {
  const status = memberStatus({ deactivatedAt: member.deactivatedAt, removedAt: null });
  const deactivated = status === "deactivated";
  const preset = presetOf(member.role, member.permissions);
  const can = memberAbilities(member, isSelf, scope);
  const anyAction = can.password || can.sessions || can.status || can.remove;
  const neverSignedIn = member.lastSignInAt === null;

  return (
    <li
      className={cn(
        "group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-2/60",
        deactivated && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(member.id)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-md"
        aria-label={`Open ${member.name}`}
      >
        <UserAvatar name={member.name} src={member.avatarUrl} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-ink">{member.name}</span>
            {isSelf && (
              <Chip>You</Chip>
            )}
            <Chip tone={preset === "admin" ? "brand" : "outline"}>{PRESET_LABEL[preset]}</Chip>
            {deactivated && <Chip tone="warn">Deactivated</Chip>}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-ink-3">
            <span className="truncate font-mono">{member.email}</span>
            <span className="hidden sm:inline" aria-hidden>
              ·
            </span>
            <span className="truncate" title={brandsSummary(member, brands)}>
              {brandsSummary(member, brands)}
            </span>
          </div>
        </div>
        {/* Last sign-in: a fact, right-aligned; "Never" is the pending state. */}
        <div
          className="hidden w-28 shrink-0 text-right text-xs tabular-nums md:block"
          title={
            neverSignedIn
              ? `Added ${isoDate(member.createdAt)} — has not signed in yet`
              : `Last sign-in ${dateTimeLabel(member.lastSignInAt)}`
          }
        >
          {neverSignedIn ? (
            <span className="text-ink-3">Never signed in</span>
          ) : (
            <span className="text-ink-2">{relativeTime(member.lastSignInAt)}</span>
          )}
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-1">
        {deactivated && can.status && (
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => onDialog("reactivate", member)}
            className="hidden sm:inline-flex"
          >
            <UserCheck className="h-3 w-3" />
            Reactivate
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-ink-3 hover:text-ink"
              aria-label={`Actions for ${member.name}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => onOpen(member.id)}>
              <Settings2 className="h-3.5 w-3.5" />
              Access &amp; brands
            </DropdownMenuItem>
            {can.password && (
              <DropdownMenuItem onSelect={() => onDialog("password", member)}>
                <KeyRound className="h-3.5 w-3.5" />
                Set password
              </DropdownMenuItem>
            )}
            {can.sessions && !deactivated && (
              <DropdownMenuItem onSelect={() => onDialog("sessions", member)}>
                <LogOut className="h-3.5 w-3.5" />
                Sign out everywhere
              </DropdownMenuItem>
            )}
            {anyAction && (can.status || can.remove) && <DropdownMenuSeparator />}
            {can.status &&
              (deactivated ? (
                <DropdownMenuItem onSelect={() => onDialog("reactivate", member)}>
                  <UserCheck className="h-3.5 w-3.5" />
                  Reactivate
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => onDialog("deactivate", member)}>
                  <UserX className="h-3.5 w-3.5" />
                  Deactivate
                </DropdownMenuItem>
              ))}
            {can.remove && (
              <DropdownMenuItem
                onSelect={() => onDialog("remove", member)}
                className="text-neg focus:text-neg"
              >
                <UserMinus className="h-3.5 w-3.5" />
                Remove from team…
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
