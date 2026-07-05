import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { auth, requireAdmin } from "@/lib/auth";
import { UserInviteForm } from "@/components/user/user-invite-form";
import { UserRoleSelect } from "@/components/user/user-role-select";
import { AdminSetPasswordButton } from "@/components/user/admin-set-password-button";
import { isoDate } from "@/lib/format";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";

export const dynamic = "force-dynamic";

export default async function UsersAdminPage() {
  await requireAdmin();
  const me = await auth();

  const team = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.name));

  return (
    <PageShell width="admin">
      <PageHeader
        eyebrow="Admin"
        title="Team"
        subtitle={`${team.length} member${team.length === 1 ? "" : "s"}.`}
      />

      <div className="rounded-lg border border-line bg-surface p-4">
        <UserInviteForm />
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm num">
          <thead>
            <tr className="text-left text-label text-ink-3 border-b border-line">
              <th className="font-medium px-3 py-2.5">Name</th>
              <th className="font-medium px-3 py-2.5">Email</th>
              <th className="font-medium px-3 py-2.5">Role</th>
              <th className="font-medium px-3 py-2.5">Joined</th>
              <th className="font-medium px-3 py-2.5 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {team.map((u) => (
              <tr key={u.id} className="hover:bg-surface-2/60 transition-colors">
                <td className="px-3 py-2.5 text-ink">{u.name}</td>
                <td className="px-3 py-2.5 font-mono text-ink-2 text-xs">{u.email}</td>
                <td className="px-3 py-2.5">
                  <UserRoleSelect
                    userId={u.id}
                    currentRole={u.role as "admin" | "editor" | "viewer"}
                    isSelf={u.id === me?.id}
                  />
                </td>
                <td className="px-3 py-2.5 text-ink-3">{isoDate(u.createdAt)}</td>
                <td className="px-3 py-2.5 text-right">
                  <AdminSetPasswordButton userId={u.id} userEmail={u.email} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
