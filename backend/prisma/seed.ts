/**
 * `npm run db:seed` — makes sure the default admin account exists and can always manage accounts and roles:
 *
 *   email:    admin@localhost
 *   password: SEED_ADMIN_PASSWORD from .env (default password123)
 *   role:     Administrator
 *
 * Safe to run any number of times (e.g. on a new PC after `npm run db:migrate`, or after someone locked
 * themselves out by editing roles):
 * - The "Administrator" role is created with every permission if missing; if it exists, every Users and
 *   Roles & Permissions permission and "Edit company profile" are added back (nothing it already has is removed).
 * - The "Staff" role is created with its default permissions if missing (an existing one is never changed).
 * - If no role is the default role for new accounts, "Staff" becomes it (an existing default is never changed,
 *   and Administrator is never made the default).
 * - admin@localhost is created, or its password is reset, it is re-activated and given the Administrator role.
 * - The company profile row exists (created with the default name "Library System" if missing; an edited one is
 *   never changed).
 * No demo data.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/services/user.service.js";
import { lockAccessChanges } from "../src/services/role.service.js";
import {
  ALL_PERMISSIONS,
  DEFAULT_STAFF_PERMISSIONS,
  SEED_ADMIN_PERMISSIONS,
  normalizePermissions,
} from "../src/lib/permissions.js";

/** The admin's password: SEED_ADMIN_PASSWORD from .env, else password123 (at least 8 characters). */
function adminPassword(): string {
  const fromEnv = process.env.SEED_ADMIN_PASSWORD?.trim();
  if (!fromEnv) return "password123";
  if (fromEnv.length < 8 || Buffer.byteLength(fromEnv, "utf8") > 72) {
    console.error("SEED_ADMIN_PASSWORD must be 8 characters – 72 bytes.");
    process.exit(1);
  }
  return fromEnv;
}

const ADMIN = {
  email: "admin@localhost",
  password: adminPassword(),
  name: "Administrator",
};

const ADMIN_ROLE = { name: "Administrator", description: "Full access, including accounts, roles and permissions." };
const STAFF_ROLE = {
  name: "Staff",
  description:
    "Day-to-day work: books, borrowers, borrow records and groupings. Cannot add, edit or delete libraries, or manage accounts and roles.",
};

/** Role names are unique regardless of case, so look them up that way. */
const findRole = (name: string) =>
  prisma.role.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true, permissions: true } });

async function main() {
  const existing = await findRole(ADMIN_ROLE.name);
  const adminRole = existing
    ? await prisma.role.update({
        where: { id: existing.id },
        data: { permissions: normalizePermissions([...existing.permissions, ...SEED_ADMIN_PERMISSIONS]) },
        select: { id: true, name: true },
      })
    : await prisma.role.create({
        data: { ...ADMIN_ROLE, permissions: [...ALL_PERMISSIONS] },
        select: { id: true, name: true },
      });

  const staffRole =
    (await findRole(STAFF_ROLE.name)) ??
    (await prisma.role.create({ data: { ...STAFF_ROLE, permissions: [...DEFAULT_STAFF_PERMISSIONS] }, select: { id: true } }));

  // New accounts get the default role: make it Staff only when there is none (serialized like the API does it).
  const defaultRole = await prisma.$transaction(async (tx) => {
    await lockAccessChanges(tx);
    const current = await tx.role.findFirst({ where: { isDefault: true }, select: { name: true } });
    if (current) return current;
    return tx.role.update({ where: { id: staffRole.id }, data: { isDefault: true }, select: { name: true } });
  });

  // The singleton company profile (the migration inserts it; this covers a database where it was deleted).
  const company = await prisma.companyProfile.upsert({ where: { id: 1 }, create: { id: 1 }, update: {}, select: { name: true } });

  const passwordHash = await hashPassword(ADMIN.password);
  await prisma.user.upsert({
    where: { email: ADMIN.email },
    create: { email: ADMIN.email, name: ADMIN.name, roleId: adminRole.id, passwordHash },
    // Bump tokenVersion so sessions signed with the old password stop working.
    update: { roleId: adminRole.id, active: true, passwordHash, tokenVersion: { increment: 1 } },
  });
  console.log(`[seed] Admin ready: ${ADMIN.email} / ${ADMIN.password} (role "${adminRole.name}", can manage users, roles and permissions)`);
  console.log(`[seed] Default role for new accounts: "${defaultRole.name}"`);
  console.log(`[seed] Company profile: "${company.name}"`);
}

main()
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
