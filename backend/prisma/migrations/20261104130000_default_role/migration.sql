-- Default role for new accounts (docs/SPEC.md "Roles and permissions"): POST /users without a roleId gives the
-- new account the role marked "isDefault".

-- AlterTable
ALTER TABLE "Role" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- At most one role is the default. Prisma cannot express this partial index in schema.prisma, so it lives only
-- here (like "Role_lower_name_key").
CREATE UNIQUE INDEX "Role_single_default_key" ON "Role" ("isDefault") WHERE "isDefault";

-- Existing databases: the "Staff" role created by 20261104120000_rbac becomes the default (if it still exists).
UPDATE "Role" SET "isDefault" = true WHERE "id" = 'role_staff';
