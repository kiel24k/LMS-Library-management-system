---
name: database-rules
description: Mandatory rules for the LMS PostgreSQL database (`lms`). Load BEFORE running any command that touches the database or could touch it — npm test / vitest, prisma migrate / db push / db:reset / db:seed, psql, createdb / dropdb, SQL (TRUNCATE, DELETE, DROP, UPDATE), editing prisma/schema.prisma or migrations, or test setup files. Never create a testing database, never delete data, and make every schema change through a Prisma migration.
---

# Database rules — LMS (owner's standing instructions)

The owner's words: *"Huwag kang gagawa ng database na pang-testing at huwag kang magbubura ng data. Puwede mong galawin
ang database, at kung may babaguhin ka, migration na lang."*

The only database is **`lms`** (`DATABASE_URL` in `backend/.env`, local PostgreSQL, user `kielbermudez`). It holds the
owner's real data (libraries, books, borrowers, borrow records, accounts, roles). It has been wiped twice by test runs,
so these rules are strict. They apply to you, to every subagent and workflow agent you start (put the rules in their
prompts), and to every session.

## 1. Never create a testing database
- Do not run `createdb`, `CREATE DATABASE`, `dropdb`, or `DROP DATABASE`, and do not add `TEST_DATABASE_URL` (or any
  other database URL) to `.env`, `.env.example`, scripts, or the vitest config.
- Do not suggest a separate test database as a workaround. The owner has decided against it.

## 2. Never delete data
Anything that removes rows, tables, or the whole database is forbidden, including:
- `npm test`, `npx vitest`, and any single test file. The test setup (`backend/tests/setup.ts`,
  `backend/tests/global-setup.ts`) runs `TRUNCATE … CASCADE` on every table, so **running the tests erases `lms`**. Do not
  run them. You may write and edit tests and type-check them (`npm run typecheck`). If tests need to run, tell the owner
  and let them decide.
- `prisma migrate reset`, `npm run db:reset`, `prisma db push --force-reset` / `--accept-data-loss`, and answering "yes" to
  any Prisma prompt that offers to reset the database (for example on drift). If Prisma wants a reset, stop and report.
- Raw SQL `TRUNCATE`, `DELETE`, `DROP TABLE`, `DROP SCHEMA`, and `UPDATE` without a narrow `WHERE`, run in psql, scripts,
  or `prisma db execute`.
- API calls or scripts that delete records (DELETE endpoints, `prisma.x.delete*`) on real data. Read-only checks are fine.
- `npm run db:seed` does not delete rows, but it resets `admin@localhost`'s password to `password123` and signs that
  account out everywhere. Ask before running it.

## 3. You may work with the database: read freely, change the schema only through migrations
Allowed:
- Read-only queries (`SELECT`, `\d`, `prisma migrate status`, Prisma Studio for viewing), and starting the dev server and
  calling read-only endpoints.
- Applying committed migrations: `npx prisma migrate deploy`, or `npx prisma migrate dev` when it applies cleanly
  without asking for a reset.

Every schema change (tables, columns, indexes, constraints, enums, default data) goes through a **new migration**:
1. Edit `backend/prisma/schema.prisma`.
2. Create the migration without applying it: `cd backend && npx prisma migrate dev --create-only --name <change>`.
3. Read the generated `migration.sql` and make it **data-preserving**:
   - Renames are `ALTER … RENAME`, never a drop followed by a re-create.
   - A new required column gets a default or a backfill `UPDATE` before `SET NOT NULL`.
   - Type changes use `USING` casts.
   - A table or column that holds data is never dropped. Move its data first, and ask the owner before removing anything.
4. Apply it: `npx prisma migrate dev` (or `npx prisma migrate deploy`), then confirm with `npx prisma migrate status`.
5. Never edit or delete a migration that has already been applied. Fix it with a new migration.
6. Never change the schema directly with SQL or `prisma db push`.

## Before you finish
Say in your report which database commands you ran. Say plainly if you skipped running tests because of these rules,
so the owner knows the tests were not run.
