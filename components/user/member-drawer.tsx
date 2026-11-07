"use client";

import { useCallback, useState } from "react";
import { KeyRound, LogOut, UserCheck, UserMinus, UserX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { UserAvatar } from "@/components/user/user-avatar";
import { UserPhotoControl } from "@/components/user/user-photo-control";
import { MemberAccessEditor } from "@/components/user/member-access-editor";
import { UserBrandsSection, type BrandOption } from "@/components/user/user-brands-section";
import { brandsSummary, memberAbilities } from "@/components/user/member-row";
import { cn } from "@/lib/utils";
import { dateTimeLabel, isoDate, relativeTime } from "@/lib/format";
import { PRESET_LABEL, presetOf } from "@/lib/team-presets";
import { teamGuard, type ManagerScope } from "@/lib/team-guard";
import type { MemberDialog, TeamMember } from "@/lib/team-member";
import { Chip } from "@/components/ui/chip";

/**
 * One member, in full (D4, 2026-11-06): the drawer a row opens. Header =
 * identity (the photo is the control, as on the old card); then Access,
 * Brands, Security (last sign-in, password, sessions) and the Danger zone
 * (deactivate / reactivate, remove). It refuses to close over unsaved
 * changes in either editor — a toast says so — because a drawer that
 * swallows a half-edited permission grid is the bug the old card never had.
 */
export function MemberDrawer({
  member,
  meId,
  brands,
  scope,
  onClose,
  onDialog,
}: {
  member: TeamMember | null;
  meId: string;
  brands: BrandOption[];
  scope: ManagerScope;
  onClose: () => void;
  onDialog: (dialog: MemberDialog, member: TeamMember) => void;
}) {
  const [accessDirty, setAccessDirty] = useState(false);
  const [brandsDirty, setBrandsDirty] = useState(false);
  const onAccessDirty = useCallback((d: boolean) => setAccessDirty(d), []);
  const onBrandsDirty = useCallback((d: boolean) => setBrandsDirty(d), []);
  const dirty = accessDirty || brandsDirty;

  const isSelf = member?.id === meId;
  const deactivated = !!member?.deactivatedAt;
  const can = member ? memberAbilities(member, isSelf, scope) : null;
  const canChangePhoto =
    !!member && teamGuard(scope, { kind: "photo", target: { role: member.role } }) === null;

  return (
    <Sheet
      open={member !== null}
      onOpenChange={(o) => {
        if (o) return;
        if (dirty) {
          toast.message("Unsaved changes", { description: "Save or discard them first." });
          return;
        }
        onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-[min(40rem,100vw)] gap-0 overflow-y-auto sm:max-w-none"
      >
        {member && can && (
          <>
            <SheetHeader className="border-b border-line pr-12">
              <div className="flex items-center gap-3">
                {canChangePhoto ? (
                  <UserPhotoControl
                    userId={member.id}
                    name={member.name}
                    avatarUrl={member.avatarUrl}
                    size="xl"
                  />
                ) : (
                  <UserAvatar name={member.name} src={member.avatarUrl} size="xl" />
                )}
                <div className="min-w-0 flex-1">
                  <SheetTitle className="flex min-w-0 flex-wrap items-center gap-2 text-base">
                    <span className="truncate">{member.name}</span>
                    {isSelf && (
                      <Chip>You</Chip>
                    )}
                    <Chip tone={presetOf(member.role, member.permissions) === "admin" ? "brand" : "outline"}>
                      {PRESET_LABEL[presetOf(member.role, member.permissions)]}
                    </Chip>
                    {deactivated && <Chip tone="warn">Deactivated</Chip>}
                  </SheetTitle>
                  <SheetDescription className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs">
                    <span className="truncate font-mono">{member.email}</span>
                    <span aria-hidden>·</span>
                    <span className="truncate">{brandsSummary(member, brands)}</span>
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="space-y-6 p-4">
              <MemberAccessEditor
                user={member}
                isSelf={isSelf}
                scope={scope}
                onDirtyChange={onAccessDirty}
              />

              <UserBrandsSection
                userId={member.id}
                isSelf={isSelf}
                isAdmin={member.role === "admin"}
                brands={brands}
                scope={scope}
                initialAllAccounts={member.allAccounts}
                initialAccountIds={member.accountIds}
                onDirtyChange={onBrandsDirty}
              />

              <section aria-labelledby="member-security-heading" className="space-y-2">
                <h3 id="member-security-heading" className="text-label text-ink-3">
                  Security
                </h3>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <dt className="text-ink-3">Last sign-in</dt>
                  <dd
                    className="text-right tabular-nums text-ink-2"
                    title={member.lastSignInAt ? dateTimeLabel(member.lastSignInAt) : undefined}
                  >
                    {member.lastSignInAt ? relativeTime(member.lastSignInAt) : "Never"}
                  </dd>
                  <dt className="text-ink-3">Joined</dt>
                  <dd className="text-right tabular-nums text-ink-2">{isoDate(member.createdAt)}</dd>
                </dl>
                {(can.password || can.sessions) && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {can.password && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onDialog("password", member)}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        Set password
                      </Button>
                    )}
                    {can.sessions && !deactivated && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onDialog("sessions", member)}
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        Sign out everywhere
                      </Button>
                    )}
                  </div>
                )}
              </section>

              {(can.status || can.remove) && (
                <section
                  aria-labelledby="member-danger-heading"
                  className={cn("space-y-2 rounded-lg border p-3", "border-neg/30 bg-neg/5")}
                >
                  <h3 id="member-danger-heading" className="text-label text-neg">
                    Danger zone
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {can.status &&
                      (deactivated ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => onDialog("reactivate", member)}
                        >
                          <UserCheck className="h-3.5 w-3.5" />
                          Reactivate
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => onDialog("deactivate", member)}
                        >
                          <UserX className="h-3.5 w-3.5" />
                          Deactivate
                        </Button>
                      ))}
                    {can.remove && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-neg hover:bg-neg/10 hover:text-neg"
                        onClick={() => onDialog("remove", member)}
                      >
                        <UserMinus className="h-3.5 w-3.5" />
                        Remove from team…
                      </Button>
                    )}
                  </div>
                </section>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
