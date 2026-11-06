"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Search, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EmptyState } from "@/components/ui/empty-state";
import { MemberRow } from "@/components/user/member-row";
import { MemberDrawer } from "@/components/user/member-drawer";
import { InviteMemberDialog } from "@/components/user/invite-member-dialog";
import { AdminSetPasswordDialog } from "@/components/user/admin-set-password-dialog";
import { DeactivateMemberDialog } from "@/components/user/deactivate-member-dialog";
import { EndSessionsDialog } from "@/components/user/end-sessions-dialog";
import { RemoveMemberDialog } from "@/components/user/remove-member-dialog";
import type { BrandOption } from "@/components/user/user-brands-section";
import { setUserStatus } from "@/app/actions/user";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";
import { holdsBrand, type ManagerScope } from "@/lib/team-guard";
import type { MemberDialog, TeamMember } from "@/lib/team-member";

type StatusFilter = "all" | "active" | "deactivated";

/** The `?member=` param — a shallow presentation param (history API, no render). */
const MEMBER_PARAM = "member";

function writeMemberParam(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set(MEMBER_PARAM, id);
  else url.searchParams.delete(MEMBER_PARAM);
  window.history.replaceState(window.history.state, "", url);
}

/**
 * The Team page's client half (D4, 2026-11-06): search, the status filter,
 * one row per member, the drawer a row opens, and the dialogs — each
 * rendered ONCE here and opened by a row's menu or by the drawer, so the two
 * entry points share one state machine. The open drawer is mirrored into
 * `?member=<id>` so a reload or a shared link lands on the same person;
 * writing it is history-API only (a presentation param, ui-system.md).
 *
 * Reactivation has no dialog: putting access back is the recoverable
 * direction, so it is one click with a toast (ux-standards "Economy").
 */
export function TeamDirectory({
  members,
  meId,
  brands,
  scope,
  initialMemberId,
}: {
  members: TeamMember[];
  meId: string;
  brands: BrandOption[];
  scope: ManagerScope;
  /** From `?member=` on the server render, so a deep link opens the drawer. */
  initialMemberId: string | null;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [openId, setOpenId] = useState<string | null>(initialMemberId);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [dialog, setDialog] = useState<{ kind: MemberDialog; member: TeamMember } | null>(null);
  const [, startTransition] = useTransition();

  // The drawer shows the LATEST version of its member — after a save the
  // revalidated list arrives in the action's response and the drawer follows.
  const openMember = useMemo(
    () => (openId ? (members.find((m) => m.id === openId) ?? null) : null),
    [members, openId],
  );
  // A member who was removed under an open drawer closes it.
  useEffect(() => {
    if (openId && !openMember) {
      setOpenId(null);
      writeMemberParam(null);
    }
  }, [openId, openMember]);

  const open = useCallback((id: string) => {
    setOpenId(id);
    writeMemberParam(id);
  }, []);
  const close = useCallback(() => {
    setOpenId(null);
    writeMemberParam(null);
  }, []);

  const counts = useMemo(() => {
    const deactivated = members.filter((m) => m.deactivatedAt !== null).length;
    return { all: members.length, active: members.length - deactivated, deactivated };
  }, [members]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members
      .filter((m) =>
        status === "all" ? true : status === "active" ? !m.deactivatedAt : !!m.deactivatedAt,
      )
      .filter((m) => !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
      // Active first, then by name — a deactivated member sits at the bottom.
      .sort((a, b) => {
        const da = a.deactivatedAt ? 1 : 0;
        const db = b.deactivatedAt ? 1 : 0;
        return da - db || a.name.localeCompare(b.name);
      });
  }, [members, query, status]);

  // An invite can only hand out brands the manager belongs to.
  const grantableBrands = useMemo(
    () => brands.filter((b) => holdsBrand(scope, b.id)),
    [brands, scope],
  );

  const onDialog = useCallback((kind: MemberDialog, member: TeamMember) => {
    if (kind === "reactivate") {
      startTransition(async () => {
        const res = await safeAction(() => setUserStatus({ userId: member.id, active: true }));
        if (!res.ok) {
          toastActionFailure(res, "Couldn't reactivate");
          return;
        }
        toast.success(`Reactivated ${member.name}`);
      });
      return;
    }
    setDialog({ kind, member });
  }, []);

  const dialogOpen = (kind: MemberDialog) => dialog?.kind === kind;
  const closeDialog = (o: boolean) => {
    if (!o) setDialog(null);
  };

  const statusOptions = [
    { value: "all" as const, label: `All · ${counts.all}` },
    { value: "active" as const, label: `Active · ${counts.active}` },
    {
      value: "deactivated" as const,
      label: `Deactivated · ${counts.deactivated}`,
      disabled: counts.deactivated === 0,
      title: counts.deactivated === 0 ? "Nobody is deactivated." : undefined,
    },
  ];

  return (
    <>
      {/* Toolbar: search, status, invite. Wraps on a phone. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email"
            aria-label="Search members"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <SegmentedControl
          options={statusOptions}
          value={status}
          onChange={setStatus}
          ariaLabel="Member status"
        />
        <Button type="button" size="sm" onClick={() => setInviteOpen(true)} className="ml-auto">
          <UserPlus className="h-3.5 w-3.5" />
          Invite
        </Button>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={<Users className="h-5 w-5" />}
          title={
            query.trim()
              ? `Nobody matches “${query.trim()}”.`
              : status === "deactivated"
                ? "Nobody is deactivated."
                : "Nobody on the team yet."
          }
          hint={query.trim() ? "Try a shorter name, or the start of an email." : undefined}
          action={
            query.trim() || status !== "all" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuery("");
                  setStatus("all");
                }}
              >
                Show everyone
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={() => setInviteOpen(true)}>
                <UserPlus className="h-3.5 w-3.5" />
                Invite a member
              </Button>
            )
          }
          size="sm"
        />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {shown.map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              isSelf={m.id === meId}
              brands={brands}
              scope={scope}
              onOpen={open}
              onDialog={onDialog}
            />
          ))}
        </ul>
      )}

      <MemberDrawer
        member={openMember}
        meId={meId}
        brands={brands}
        scope={scope}
        onClose={close}
        onDialog={onDialog}
      />

      <InviteMemberDialog
        brands={grantableBrands}
        scope={scope}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInvited={(id) => {
          if (id) open(id);
        }}
      />
      <AdminSetPasswordDialog
        member={dialog?.member ?? null}
        open={dialogOpen("password")}
        onOpenChange={closeDialog}
      />
      <EndSessionsDialog
        member={dialog?.member ?? null}
        open={dialogOpen("sessions")}
        onOpenChange={closeDialog}
      />
      <DeactivateMemberDialog
        member={dialog?.member ?? null}
        open={dialogOpen("deactivate")}
        onOpenChange={closeDialog}
      />
      <RemoveMemberDialog
        member={dialog?.member ?? null}
        open={dialogOpen("remove")}
        onOpenChange={closeDialog}
        onRemoved={(id) => {
          if (openId === id) close();
        }}
      />
    </>
  );
}
