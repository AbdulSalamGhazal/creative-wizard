import { requirePermission } from "@/lib/auth";
import { listAllAccounts } from "@/lib/tenant";
import { listTeamWithMemberships, managerScope } from "@/db/queries/team";
import { holdsBrand } from "@/lib/team-guard";
import { InfoTip } from "@/components/ui/info-tip";
import { UserInviteForm } from "@/components/user/user-invite-form";
import { UserAccessCard, type AccessUser } from "@/components/user/user-access-card";
import { isoDate } from "@/lib/format";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";

export const dynamic = "force-dynamic";

export const metadata = { title: "Team" };

/**
 * Team — the single place to add people and manage what they can do. Invite at
 * the top; each member is a card that owns their access (role preset + granular
 * permissions) and password reset, so there's one flow instead of two pages.
 *
 * Below admin, a manager works within their own access (`teamGuard`, D1): the
 * same guard the actions enforce decides what each card hides or locks.
 */
export default async function TeamAdminPage() {
  const me = await requirePermission("users.manage");

  const [team, brands, scope] = await Promise.all([
    listTeamWithMemberships(),
    // Full (unfiltered) brand list: every card shows the person's real brands.
    // What a restricted manager may GRANT is narrowed below and by the guard.
    listAllAccounts(),
    managerScope(me),
  ]);

  const brandOptions = brands.map((b) => ({ id: b.id, name: b.name }));
  // An invite can only hand out brands the manager belongs to.
  const grantableBrands = brandOptions.filter((b) => holdsBrand(scope, b.id));

  return (
    <PageShell width="admin">
      <PageHeader
        eyebrow="Admin"
        title="Team"
        subtitle={
          <>
            {`${team.length} member${team.length === 1 ? "" : "s"}. Invite teammates and set exactly what each can do — admins always have full access.`}
            {!scope.isAdmin && (
              <InfoTip label="What you can change" className="ml-1 align-[-2px]">
                You can change only the permissions and brands you have
                yourself — the others are greyed out — and set a password only
                for someone whose access is within yours. Only an admin can
                change an admin.
              </InfoTip>
            )}
          </>
        }
      />

      <div className="rounded-lg border border-line bg-surface p-4">
        <UserInviteForm brands={grantableBrands} scope={scope} />
      </div>

      <div className="space-y-4">
        {team.map((u) => (
          <UserAccessCard
            key={u.id}
            user={
              {
                id: u.id,
                name: u.name,
                email: u.email,
                role: u.role as AccessUser["role"],
                permissions: u.permissions,
                allAccounts: u.allAccounts,
                accountIds: u.accountIds,
                avatarUrl: u.avatarUrl,
                joined: isoDate(u.createdAt),
              } satisfies AccessUser
            }
            isSelf={u.id === me.id}
            brands={brandOptions}
            scope={scope}
          />
        ))}
      </div>
    </PageShell>
  );
}
