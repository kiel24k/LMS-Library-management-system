-- Company profile, borrower online accounts and accept/reject emails (docs/SPEC.md "Company profile",
-- "Borrower accounts"). Hand-written: the singleton CHECK, the seeded row and the permission grant cannot be
-- expressed in schema.prisma.

-- CreateTable
-- The organisation's name, logo and contact details (shown on every page and in emails). Exactly one row.
CREATE TABLE "CompanyProfile" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL DEFAULT 'Library System',
    "tagline" TEXT,
    "address" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "logoMimeType" TEXT,
    "logoData" BYTEA,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyProfile_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CompanyProfile_singleton" CHECK ("id" = 1)
);

-- The one row, with the name the app had before it became editable. Timestamps hold UTC (see 20261104120000_rbac).
INSERT INTO "CompanyProfile" ("id", "name", "updatedAt") VALUES (1, 'Library System', (now() AT TIME ZONE 'UTC'));

-- AlterTable: borrower online accounts (created when a public request is accepted). Emails are stored trimmed and
-- lower-cased by the API, so a plain unique index is enough.
ALTER TABLE "Borrower" ADD COLUMN "email" TEXT,
ADD COLUMN "passwordHash" TEXT,
ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "Borrower_email_key" ON "Borrower"("email");

-- AlterTable: outcome of the accept/reject email of a public request.
ALTER TABLE "Loan" ADD COLUMN "notifiedAt" TIMESTAMP(3),
ADD COLUMN "notifyError" TEXT;

-- The new "company.update" permission goes to every role that can already edit roles (so the Administrator role,
-- and any role an administrator built like it, can edit the company profile right away). It is last in the
-- catalog, so appending keeps the stored list in catalog order.
UPDATE "Role"
   SET "permissions" = array_append("permissions", 'company.update')
 WHERE 'roles.update' = ANY ("permissions")
   AND NOT ('company.update' = ANY ("permissions"));
