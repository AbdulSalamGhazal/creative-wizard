import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { auth, requirePermission } from "@/lib/auth";
import { UserInviteForm } from "@/components/user/user-invite-form";
import { UserAccessCard, type AccessUser } from "@/components/user/user-access-card";
import { isoDate } from "@/lib/format";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";

export const dynamic = "force-dynamic";

/**
 * Team — the single place to add people and manage what they can do. Invite at
 * the top; each member is a card that owns their access (role preset + granular
 * permissions) and password reset, so there's one flow instead of two pages.
 */
export default async function TeamAdminPage() {
  await requirePermission("users.manage");
  const me = await auth();

  const team = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      permissions: users.permissions,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.name));

  return (
    <PageShell width="admin">
      <PageHeader
        eyebrow="Admin"
        title="Team"
        subtitle={`${team.length} member${team.length === 1 ? "" : "s"}. Invite teammates and set exactly what each can do — admins always have full access.`}
      />

      <div className="rounded-lg border border-line bg-surface p-4">
        <UserInviteForm />
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
                joined: isoDate(u.createdAt),
              } satisfies AccessUser
            }
            isSelf={u.id === me?.id}
          />
        ))}
      </div>
    </PageShell>
  );
}
