-- One account system (docs/SPEC.md "Accounts"): borrowers no longer have a separate online account. The account
-- created when a request is accepted is an ordinary `User` with the default role, linked to its borrower through
-- "User"."borrowerId"; the "My Books" page (permission my_books.view) shows that borrower's records.
-- Hand-written (the data move and the permission grant cannot be expressed in schema.prisma). Nothing is dropped:
-- "Borrower"."passwordHash", "mustChangePassword" and "tokenVersion" keep their data (deprecated, unused by the
-- code) until the owner approves removing them.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "borrowerId" TEXT;

-- CreateIndex: an account belongs to at most one borrower and a borrower has at most one account.
CREATE UNIQUE INDEX "User_borrowerId_key" ON "User"("borrowerId");

-- AddForeignKey: deleting a borrower keeps the account (it just stops being linked).
ALTER TABLE "User" ADD CONSTRAINT "User_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data move, for every borrower that had an online account (password + email). Emails are stored lower-cased on
-- both tables; lower() on "User" only guards against an old mixed-case row.
-- a) An account with the same email already exists → link it (its password and role are left as they are).
--    DISTINCT ON picks one account per borrower even if two rows differ only in case.
UPDATE "User" u
   SET "borrowerId" = m."borrowerId"
  FROM (
        SELECT DISTINCT ON (b."id") b."id" AS "borrowerId", x."id" AS "userId"
          FROM "Borrower" b
          JOIN "User" x ON lower(x."email") = b."email"
         WHERE b."passwordHash" IS NOT NULL
           AND b."email" IS NOT NULL
           AND x."borrowerId" IS NULL
         ORDER BY b."id", x."createdAt", x."id"
       ) m
 WHERE u."id" = m."userId"
   AND NOT EXISTS (SELECT 1 FROM "User" l WHERE l."borrowerId" = m."borrowerId");

-- b) No account with that email → create one with the default role, carrying over the borrower's password hash and
--    whether they still have to change the default password. Skipped (data stays in the deprecated columns) when
--    no role is the default. Ids look like Prisma's cuids (25 chars starting with "c"). Timestamps hold UTC (see
--    20261104120000_rbac).
INSERT INTO "User" (
    "id", "email", "name", "passwordHash", "roleId", "active", "tokenVersion", "mustChangePassword", "borrowerId",
    "createdAt", "updatedAt"
)
SELECT 'c' || substr(md5(random()::text || b."id" || clock_timestamp()::text), 1, 24),
       b."email",
       b."name",
       b."passwordHash",
       r."id",
       true,
       0,
       b."mustChangePassword",
       b."id",
       (now() AT TIME ZONE 'UTC'),
       (now() AT TIME ZONE 'UTC')
  FROM "Borrower" b
 CROSS JOIN (SELECT "id" FROM "Role" WHERE "isDefault" LIMIT 1) r
 WHERE b."passwordHash" IS NOT NULL
   AND b."email" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "User" u WHERE lower(u."email") = b."email")
   AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."borrowerId" = b."id");

-- The new "my_books.view" permission goes to the default role (so accepted borrowers, who get it, can see their
-- books) and to every role that can already edit roles. It is last in the catalog, so appending keeps the stored
-- list in catalog order.
UPDATE "Role"
   SET "permissions" = array_append("permissions", 'my_books.view')
 WHERE ("isDefault" OR 'roles.update' = ANY ("permissions"))
   AND NOT ('my_books.view' = ANY ("permissions"));
