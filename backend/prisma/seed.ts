/**
 * `npm run db:seed` — makes sure the default admin account exists:
 *
 *   email:    admin@localhost
 *   password: password123
 *
 * Safe to run any number of times (e.g. on a new PC after `npm run db:migrate`). If the account
 * already exists, its password is reset to the default, and it is re-activated as ADMIN.
 * No demo data.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/services/user.service.js";

const ADMIN = {
  email: "admin@localhost",
  password: "password123",
  name: "Administrator",
};

async function main() {
  const passwordHash = await hashPassword(ADMIN.password);
  await prisma.user.upsert({
    where: { email: ADMIN.email },
    create: { email: ADMIN.email, name: ADMIN.name, role: "ADMIN", passwordHash },
    // Bump tokenVersion so sessions signed with the old password stop working.
    update: { role: "ADMIN", active: true, passwordHash, tokenVersion: { increment: 1 } },
  });
  console.log(`[seed] Admin ready: ${ADMIN.email} / ${ADMIN.password}`);
}

main()
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
