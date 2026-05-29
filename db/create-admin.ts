/**
 * Create (or reset) a single admin user — no demo data. Use this to bootstrap
 * the first admin on a fresh production database; everyone else is then invited
 * from /admin/users.
 *
 * Usage:
 *   Local:  ADMIN_EMAIL=you@co.com ADMIN_PASSWORD='a-strong-pass' \
 *             npx tsx --env-file=.env.local db/create-admin.ts
 *   Prod:   DATABASE_URL='<pooled-url>' ADMIN_EMAIL=you@co.com \
 *             ADMIN_PASSWORD='a-strong-pass' npx tsx db/create-admin.ts
 *
 * Idempotent: if the email already exists, its password is reset and role set
 * to admin.
 */
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { hashPassword, PASSWORD_MIN_LENGTH } from "@/lib/auth-password";

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || "Admin";

  if (!email || !password) {
    console.error(
      "Set ADMIN_EMAIL and ADMIN_PASSWORD. e.g.\n" +
        "  ADMIN_EMAIL=you@co.com ADMIN_PASSWORD='a-strong-pass' npx tsx db/create-admin.ts",
    );
    process.exit(1);
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    console.error(`ADMIN_PASSWORD must be at least ${PASSWORD_MIN_LENGTH} characters.`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const [row] = await db
    .insert(users)
    .values({ email, name, role: "admin", passwordHash })
    .onConflictDoUpdate({
      target: users.email,
      set: { passwordHash, role: "admin" },
    })
    .returning({ id: users.id, email: users.email });

  console.log(`Admin ready: ${row?.email} (${row?.id})`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
