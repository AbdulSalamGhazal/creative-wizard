import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { auth, requirePermission } from "@/lib/auth";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";
import {
  UserAccessCard,
  type AccessUser,
} from "@/components/user/user-access-card";

export const dynamic = "force-dynamic";

export default async function AccessAdminPage() {
  await requirePermission("users.manage");
  const me = await auth();

  const team = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      permissions: users.permissions,
    })
    .from(users)
    .orderBy(asc(users.name));

  return (
    <PageShell width="admin">
      <PageHeader
        eyebrow="Admin"
        title="Access"
        subtitle="Grant each teammate exactly what they need. Admins always have full access; everyone else gets a preset or a custom set of permissions."
      />

      <div className="space-y-4">
        {team.map((u) => (
          <UserAccessCard
            key={u.id}
            user={u as AccessUser}
            isSelf={u.id === me?.id}
          />
        ))}
      </div>
    </PageShell>
  );
}
