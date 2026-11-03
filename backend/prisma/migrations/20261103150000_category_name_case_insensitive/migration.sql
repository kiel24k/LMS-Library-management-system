-- Grouping (category) names are unique per library regardless of case (docs/SPEC.md).
-- The (libraryId, name) index from init is case-sensitive, so two concurrent requests for "Fiction" and
-- "fiction" could both pass the application's case-insensitive check. This expression index makes the
-- database enforce the rule (Prisma cannot express it in schema.prisma, so it lives only here).
CREATE UNIQUE INDEX "Category_libraryId_lower_name_key" ON "Category" ("libraryId", lower("name"));
