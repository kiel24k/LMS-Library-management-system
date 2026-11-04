# LMS — Library Lending System

## Database rules (mandatory — full text: `.claude/skills/database-rules/SKILL.md`, load it before any database work)
- **Never create a testing database.** No `createdb` / `CREATE DATABASE`, and no `TEST_DATABASE_URL`. The only database is `lms`.
- **Never delete data.** No `npm test` or `vitest` (the test setup TRUNCATEs every table in `lms`), no `prisma migrate reset` /
  `db:reset` / `db push --force-reset`, and no `TRUNCATE` / `DELETE` / `DROP`. Ask before `npm run db:seed`, which resets the admin password.
- **You may work with the database; every schema change goes through a new, data-preserving Prisma migration**
  (`npx prisma migrate dev --create-only`, review the SQL, then apply). Never edit an applied migration and never use `db push`.
- Pass these rules on to every subagent or workflow agent that may touch the database.
