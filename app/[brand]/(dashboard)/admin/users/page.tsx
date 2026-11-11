import { refusable, requirePermission } from "@/lib/auth";
import { AccessRefused } from "@/components/layout/access-refused";
import { TEAM_GATE } from "@/lib/page-gates";
import { listAllAccounts } from "@/lib/tenant";
import { listTeamWithMemberships, managerScope } from "@/db/queries/team";
import { TeamDirectory } from "@/components/user/team-directory";
import type { TeamMember } from "@/lib/team-member";
import type { RoleTier } from "@/lib/enums";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";

export const dynamic = "force-dynamic";

export const metadata = { title: "Team" };

interface Props {
  searchParams: Promise<{ member?: string }>;
}

/**
 * Team — the single place to add people and manage what they can do (D4,
 * 2026-11-06). A directory: search, status, one row per member; a row opens
 * the drawer with their access, brands, security and danger zone; Invite is
 * the toolbar's one button. Deactivated members stay listed (dimmed, badged,
 * last); removed members are gone from here for good.
 *
 * Below admin, a manager works within their own access (`teamGuard`, D1): the
 * same guard the actions enforce decides what each row and drawer hides.
 */
export default async function TeamAdminPage({ searchParams }: Props) {
  const me = await refusable(() => requirePermission(TEAM_GATE));
  if (!me) return <AccessRefused page="Team" perm={TEAM_GATE} />;
  const { member } = await searchParams;

  const [team, brands, scope] = await Promise.all([
    listTeamWithMemberships(),
    // Full (unfiltered) brand list: every row shows the person's real brands.
    // What a restricted manager may GRANT is narrowed by the guard.
    listAllAccounts(),
    managerScope(me),
  ]);

  const members: TeamMember[] = team.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role as RoleTier,
    permissions: u.permissions,
    allAccounts: u.allAccounts,
    accountIds: u.accountIds,
    avatarUrl: u.avatarUrl,
    createdAt: u.createdAt.toISOString(),
    deactivatedAt: u.deactivatedAt?.toISOString() ?? null,
    lastSignInAt: u.lastSignInAt?.toISOString() ?? null,
  }));

  const active = members.filter((m) => m.deactivatedAt === null).length;
  const admins = members.filter((m) => m.role === "admin" && m.deactivatedAt === null).length;
  const deactivated = members.length - active;
  const subtitle = [
    `${active} member${active === 1 ? "" : "s"}`,
    `${admins} admin${admins === 1 ? "" : "s"}`,
    deactivated > 0 ? `${deactivated} deactivated` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <PageShell width="admin">
      <PageHeader
        eyebrow="Admin"
        title="Team"
        subtitle={subtitle}
        info={
          scope.isAdmin ? (
            "Admins always have full access. Deactivating keeps a person's access and work on hold; removing frees their email and keeps their work in their name."
          ) : (
            <>
              Admins always have full access. You can change only the permissions and brands
              you have yourself — the others are greyed out — and set a password, deactivate
              or remove only someone whose access is within yours. Only an admin can change an
              admin.
            </>
          )
        }
        infoLabel={scope.isAdmin ? "About access" : "What you can change"}
      />

      <TeamDirectory
        members={members}
        meId={me.id}
        brands={brands.map((b) => ({ id: b.id, name: b.name }))}
        scope={scope}
        initialMemberId={member && members.some((m) => m.id === member) ? member : null}
      />
    </PageShell>
  );
}
