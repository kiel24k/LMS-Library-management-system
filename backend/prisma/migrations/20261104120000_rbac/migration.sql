-- Role-based access control (docs/SPEC.md "Roles and permissions"): the fixed ADMIN / STAFF enum becomes a "Role"
-- table; each role holds a list of permission keys (catalog: src/lib/permissions.ts) and every user has one role.
-- Hand-written so existing accounts keep their access: ADMIN → "Administrator" (all permissions), STAFF → "Staff"
-- (everything the old STAFF role could do).

-- In PostgreSQL every table also creates a composite type with its own name, so the old enum type "Role" has to
-- get out of the way before the "Role" table can be created. It is dropped at the end.
ALTER TYPE "Role" RENAME TO "Role_old";

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- Role names are unique regardless of case ("Staff" and "staff" cannot both exist). Prisma cannot express this
-- expression index in schema.prisma, so it lives only here (like "Category_libraryId_lower_name_key").
CREATE UNIQUE INDEX "Role_lower_name_key" ON "Role" (lower("name"));

-- Default roles (fixed ids so the data migration below can reference them). The timestamp columns hold UTC (that
-- is how Prisma writes and reads them), so take now() in UTC rather than CURRENT_TIMESTAMP, which would store the
-- server's local time.
INSERT INTO "Role" ("id", "name", "description", "permissions", "createdAt", "updatedAt") VALUES
(
    'role_administrator',
    'Administrator',
    'Full access, including accounts, roles and permissions.',
    ARRAY['dashboard.view', 'libraries.view', 'libraries.create', 'libraries.update', 'libraries.delete', 'categories.create', 'categories.update', 'categories.delete', 'books.view', 'books.create', 'books.update', 'books.delete', 'borrowers.view', 'borrowers.create', 'borrowers.update', 'borrowers.delete', 'loans.view', 'loans.create', 'loans.update', 'loans.approve', 'loans.cancel', 'loans.return', 'users.view', 'users.create', 'users.update', 'users.deactivate', 'users.reset_password', 'roles.view', 'roles.create', 'roles.update', 'roles.delete'],
    (now() AT TIME ZONE 'UTC'),
    (now() AT TIME ZONE 'UTC')
),
(
    'role_staff',
    'Staff',
    'Day-to-day work: books, borrowers, borrow records and groupings. Cannot add, edit or delete libraries, or manage accounts and roles.',
    ARRAY['dashboard.view', 'libraries.view', 'categories.create', 'categories.update', 'categories.delete', 'books.view', 'books.create', 'books.update', 'books.delete', 'borrowers.view', 'borrowers.create', 'borrowers.update', 'borrowers.delete', 'loans.view', 'loans.create', 'loans.update', 'loans.approve', 'loans.cancel', 'loans.return'],
    (now() AT TIME ZONE 'UTC'),
    (now() AT TIME ZONE 'UTC')
);

-- AlterTable: move every user from the old enum column to the matching role.
ALTER TABLE "User" ADD COLUMN "roleId" TEXT;
UPDATE "User" SET "roleId" = CASE "role" WHEN 'ADMIN' THEN 'role_administrator' ELSE 'role_staff' END;
ALTER TABLE "User" ALTER COLUMN "roleId" SET NOT NULL;
ALTER TABLE "User" DROP COLUMN "role";

-- CreateIndex
CREATE INDEX "User_roleId_idx" ON "User"("roleId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DropEnum
DROP TYPE "Role_old";
