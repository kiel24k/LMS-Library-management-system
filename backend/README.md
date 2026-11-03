# LMS Backend

Library System API (book borrowing): Node 22, Express 5, Prisma 7 (PostgreSQL, `@prisma/adapter-pg`), TypeScript (ESM),
zod, JWT cookie auth. The product spec and API contract live in [`../docs/SPEC.md`](../docs/SPEC.md); the
[project README](../README.md) has the plain-language overview, first-time setup and the staff's daily workflow.

Naming: internally a borrow record is a **loan** (`Loan` model, `/api/loans`, `loanNumber`, `defaultLoanDays`,
error codes such as `BOOK_HAS_LOANS`), but nothing users read may say "loan" or "lending": human-readable error
`message`s use "borrow record" / "borrowed", and the display code is a reference number like `BR-000123`
(see Terminology in the spec).

## Setup from zero

Needs a PostgreSQL on `localhost:5432` (user `postgres` / `postgres`; adjust `DATABASE_URL` otherwise). No
PostgreSQL installed? Use `npm run db:local` (below).

```bash
cd backend
npm install                      # also runs `prisma generate`
cp .env.example .env             # PowerShell: Copy-Item .env.example .env. JWT_SECRET is optional in development
npm run db:migrate               # creates the `lms` database if missing and applies prisma/migrations
npm run db:seed                  # admin account: admin@localhost / password123
npm run dev                      # API on http://localhost:3000 (health: GET /api/health)
```

`npm run db:seed` (`prisma/seed.ts`) always leaves the account **admin@localhost / password123** as an active ADMIN:
it creates it, or resets the password if it already exists (existing sessions of that account are signed out).
Change the password on a real server.

The frontend dev server (port 5174) proxies `/api` to this server, so cookies work same-origin.

### About `npm run db:local` (only without an installed PostgreSQL)

Runs a real PostgreSQL 18 server from the `embedded-postgres` npm package, with its data in `backend/.pgdata/`
(git-ignored). Keep it running in its own terminal while you work.

- Listens on `localhost:5432`, user `postgres`, password `postgres`; creates database `lms` if missing.
- First run initialises the cluster (UTF-8, ICU `en-US` collation so lists sort naturally: "alpha" before "Bravo").
- Stop it with **Ctrl+C** in its terminal, or `npm run db:stop` from another terminal (both do a clean
  `pg_ctl stop -m fast`).
- If port 5432 is already in use (for example by a PostgreSQL you installed as a Windows service), it refuses to
  start and never touches the other process. Either use that server instead (point `DATABASE_URL` at it), or run the
  embedded one on another port. Put both lines in `.env` (`db:local` reads `DB_LOCAL_PORT` from it, so plain
  `npm run db:local` keeps working):

  ```bash
  DB_LOCAL_PORT=5433
  DATABASE_URL="postgresql://postgres:postgres@localhost:5433/lms?schema=public"
  ```

  (A one-off shell variable works too: `DB_LOCAL_PORT=5433 npm run db:local`, PowerShell
  `$env:DB_LOCAL_PORT=5433; npm run db:local`.)
- Using an installed PostgreSQL instead: create a database, set `DATABASE_URL`, and skip `db:local`.

## Environment (`.env`)

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/lms?schema=public` | installed PostgreSQL (or `db:local`) |
| `PORT` | `3000` | |
| `CORS_ORIGIN` | `http://localhost:5174` | comma-separated list; credentials allowed |
| `JWT_SECRET` | dev default (with a warning) | **required in production** (≥ 32 chars) — the server refuses to start without it |
| `APP_TIMEZONE` | `Asia/Manila` | "today", due dates, overdue and "this month" |
| `TRUST_PROXY` | unset | optional Express "trust proxy" (e.g. `1`) behind a reverse proxy, so rate limits see client IPs. Only set it when that proxy sets `X-Forwarded-For` (nginx; the Vite proxy only with `xfwd: true`), otherwise clients can spoof their IP |
| `DB_LOCAL_PORT` | `5432` | port for `db:local` only (read from `.env` or the shell); keep `DATABASE_URL` on the same port |

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start with hot reload (tsx watch) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server (`dist/index.js`) |
| `npm run typecheck` | Type-check sources, tests, scripts and seed |
| `npm test` | Run the test suite (vitest + supertest) on the `lms` database — **erases all data**, then re-seeds the admin |
| `npm run db:local` | Run the embedded PostgreSQL (see above) |
| `npm run db:stop` | Cleanly stop the server started by `db:local` (by data directory, never by port) |
| `npm run db:generate` | Generate the Prisma client |
| `npm run db:migrate` | `prisma migrate dev` — apply migrations / create a new one after editing the schema |
| `npm run db:deploy` | `prisma migrate deploy` — apply migrations (production / CI) |
| `npm run db:seed` | Create or reset the admin account `admin@localhost` / `password123` (no demo data) |
| `npm run db:studio` | Open Prisma Studio |
| `npm run db:reset` | Drop and re-create the database, re-apply migrations, then seed (asks for confirmation) |

## Tests

```bash
npm test             # needs the PostgreSQL from DATABASE_URL running (installed, or `npm run db:local`)
```

> **Warning:** the tests run on the app's own database (`DATABASE_URL`, i.e. `lms`; override with
> `TEST_DATABASE_URL`). Every test starts by emptying all tables, so **all libraries, books, borrowers, borrow
> records and users are deleted**. When the run finishes, the tables are emptied once more and the seed runs, so only
> `admin@localhost` / `password123` is left (log in again afterwards).

The global setup applies migrations first; files run one at a time. Rate limiting is disabled for most tests and
exercised explicitly where tested.

## Structure

```
prisma/schema.prisma          data model (see docs/SPEC.md)
prisma/migrations/            SQL migrations (init also adds CHECK constraints on stock counts)
prisma/seed.ts                admin seed
prisma.config.ts              Prisma config (schema, migrations, seed, DATABASE_URL)
scripts/db-local.ts           embedded PostgreSQL runner (db:local); db-stop.ts (db:stop)
src/index.ts                  entry point (listen + graceful shutdown)
src/app.ts                    createApp(): helmet, CORS, JSON, cookies, routers, error handling
src/config/env.ts             zod-validated environment
src/middleware/               auth (cookie JWT, requireAuth/requireRole), validate, json-only (415), rate limits, errors
src/routes/                   one router per resource (auth, public, libraries+categories, books, borrowers, loans, dashboard, users)
src/services/                 business logic; loan.service.ts holds stock / approval / return rules
src/lib/                      prisma client, HttpError, dates (APP_TIMEZONE), reference numbers (BR-000123), slugs, zod helpers
src/generated/prisma/         generated Prisma client (git-ignored)
tests/                        vitest + supertest suites
```

### Concurrency guarantees

All stock and status changes run in a Prisma `$transaction` with conditional atomic updates
(`updateMany … where availableCopies >= q` / `where status = 'PENDING'`, checking the affected count), so concurrent
borrows never oversell the last copy, a double-clicked approve or return check applies once, and two admins cannot
deactivate each other into having no active admin. The test suite exercises these with parallel requests.

Rows that a new loan, request or book will reference (books, borrower, library, grouping) are read with
`SELECT … FOR KEY SHARE` inside the same transaction, so a concurrent delete waits and then fails with its own
409 (`BOOK_HAS_LOANS`, …) instead of the insert failing with a foreign-key error. Grouping names are unique per
library regardless of case at the database level (`UNIQUE ("libraryId", lower("name"))`, added in a migration because
Prisma cannot express it). `tests/races.test.ts` reproduces these races deterministically.

### Sessions

Each JWT carries the user's `tokenVersion`; logout, a password change, an admin password reset and deactivation bump it,
so older tokens (including copied cookies) stop working at once instead of after 7 days.

## API errors

Every error is `{ "error": { "code", "message", "details"? } }` — codes are listed in `docs/SPEC.md`. In addition
to the spec's list, a body over the size limit returns **413 `PAYLOAD_TOO_LARGE`** (limit 100kb; 1mb for
`POST /api/books/bulk`; 2mb for `PUT /api/books/:id/cover`). Book pictures are stored in the database
(`BookCover`, one per book, deleted with the book) and served by `GET /api/books/:id/cover` to logged-in staff only. Unmapped foreign-key or write-conflict errors from a race return **409 `CONFLICT`**
(retryable) instead of 500.
