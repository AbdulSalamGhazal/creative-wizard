import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { userAccounts, users } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { listAllAccounts } from "@/lib/tenant";
import { managerScope } from "@/db/queries/team";
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

  const [team, brands, memberships, scope] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        permissions: users.permissions,
        allAccounts: users.allAccounts,
        avatarUrl: users.avatarUrl,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(asc(users.name)),
    // Full (unfiltered) brand list: every card shows the person's real brands.
    // What a restricted manager may GRANT is narrowed below and by the guard.
    listAllAccounts(),
    db
      .select({
        userId: userAccounts.userId,
        accountId: userAccounts.accountId,
      })
      .from(userAccounts),
    managerScope(me),
  ]);

  // Group memberships by user for O(1) lookup per card.
  const membershipsByUser = new Map<string, string[]>();
  for (const m of memberships) {
    const arr = membershipsByUser.get(m.userId);
    if (arr) arr.push(m.accountId);
    else membershipsByUser.set(m.userId, [m.accountId]);
  }
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
                accountIds: membershipsByUser.get(u.id) ?? [],
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
