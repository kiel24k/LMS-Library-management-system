-- AlterTable
-- Every JWT carries the user's tokenVersion; bumping it invalidates all earlier tokens of that user.
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
