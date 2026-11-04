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
npm run db:seed                  # admin account: admin@localhost / password123 (Administrator role)
npm run dev                      # API on http://localhost:3000 (health: GET /api/health)
```

`npm run db:seed` (`prisma/seed.ts`) always leaves the account **admin@localhost** (password: `SEED_ADMIN_PASSWORD` in `.env`, default `password123`) active with the
**Administrator** role, and that role always holds every Users and Roles & Permissions permission (if someone removed
them, the seed adds them back; nothing else is taken away). If the role does not exist yet it is created with every
permission (it also always keeps "Edit company profile"); a default **Staff** role is created if missing (an existing one is never changed), and if no role is the
default role for new accounts, Staff becomes it (an existing default is kept; Administrator is never made the
default). The account is created,
or its password is reset if it already exists (existing sessions of that account are signed out). So the seed is also
the way back in after locking yourself out of user or role management. Change the password on a real server.

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
| `APP_PUBLIC_URL` | `http://localhost:5174` | the web app's address; the sign-in link in emails is `<APP_PUBLIC_URL>/login` |
| `BORROWER_DEFAULT_PASSWORD` | `password123` | first password of the account created when a borrower's request is accepted (8 characters – 72 bytes); written in the acceptance email, must be changed at the first sign-in |
| `SMTP_HOST` | unset | mail server for the accept/reject emails. **Unset: nothing is sent** — the email is printed in this terminal instead |
| `SMTP_PORT` / `SMTP_SECURE` | `587` / `false` | `SMTP_SECURE=true` for port 465 (TLS from the start); `false` uses STARTTLS |
| `SMTP_USER` / `SMTP_PASS` | unset | SMTP login (e.g. a Gmail address and an *app password*) |
| `MAIL_FROM` | company name | sender, e.g. `"St. Luke Library <library@example.org>"`; a name without an address (or no `MAIL_FROM`) is sent from `SMTP_USER` when that is an email address, else from `no-reply@localhost` |

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
| `npm run db:seed` | Create or reset the admin account `admin@localhost` / `password123` with the Administrator role (no demo data) |
| `npm run db:studio` | Open Prisma Studio |
| `npm run db:reset` | Drop and re-create the database, re-apply migrations, then seed (asks for confirmation) |

## Tests

```bash
npm test             # needs the PostgreSQL from DATABASE_URL running (installed, or `npm run db:local`)
```

> **Warning:** the tests run on the app's own database (`DATABASE_URL`, i.e. `lms`). Every test starts by emptying
> all tables, so **all libraries, books, borrowers, borrow records, users and roles are deleted**. When the run
> finishes, the tables are emptied once more and the seed runs, so only `admin@localhost` / `password123` is left
> (log in again afterwards).

The global setup applies migrations first; files run one at a time. Rate limiting is disabled for most tests and
exercised explicitly where tested.

## Structure

```
prisma/schema.prisma          data model (see docs/SPEC.md)
prisma/migrations/            SQL migrations (init also adds CHECK constraints on stock counts)
prisma/seed.ts                admin seed (Administrator / Staff roles + admin@localhost)
prisma.config.ts              Prisma config (schema, migrations, seed, DATABASE_URL)
scripts/db-local.ts           embedded PostgreSQL runner (db:local); db-stop.ts (db:stop)
src/index.ts                  entry point (listen + graceful shutdown)
src/app.ts                    createApp(): helmet, CORS, JSON, cookies, routers, error handling
src/config/env.ts             zod-validated environment
src/middleware/               auth (cookie JWT, requireAuth/requirePermission/requireAnyPermission), validate, json-only (415), rate limits, errors
src/routes/                   one router per resource (auth, public, libraries+categories, books, borrowers, loans, dashboard, users, roles+permissions, company, me = "My Books")
src/services/                 business logic; loan.service.ts holds stock / approval / return rules, notification.service.ts the accept/reject emails, company.service.ts the company profile
src/lib/                      prisma client, HttpError, permission catalog (permissions.ts), dates (APP_TIMEZONE), reference numbers (BR-000123), slugs, zod helpers, picture checks (images.ts), mailer.ts (SMTP / console / test outbox)
src/generated/prisma/         generated Prisma client (git-ignored)
tests/                        vitest + supertest suites
```

### Concurrency guarantees

All stock and status changes run in a Prisma `$transaction` with conditional atomic updates
(`updateMany … where availableCopies >= q` / `where status = 'PENDING'`, checking the affected count), so concurrent
borrows never oversell the last copy and a double-clicked approve or return check applies once. Changes that can take
away the ability to manage users and roles (editing a role's permissions, changing an account's role, deactivating an
account) take a transaction-level advisory lock (`pg_advisory_xact_lock`) and then check that an active account
still holds `users.view`, `users.update`, `roles.view` and `roles.update` (409 `ACCESS_LOCKOUT`), so two admins
cannot lock each other out at the same time. The test suite exercises these with parallel requests.

Rows that a new loan, request or book will reference (books, borrower, library, grouping) are read with
`SELECT … FOR KEY SHARE` inside the same transaction, so a concurrent delete waits and then fails with its own
409 (`BOOK_HAS_LOANS`, …) instead of the insert failing with a foreign-key error. Grouping names are unique per
library regardless of case at the database level (`UNIQUE ("libraryId", lower("name"))`, added in a migration because
Prisma cannot express it). `tests/races.test.ts` reproduces these races deterministically.

### Sessions

Each JWT carries the user's `tokenVersion`; logout, a password change, a password reset and deactivation bump it,
so older tokens (including copied cookies) stop working at once instead of after 7 days. There is one kind of
account (`User`) and one app: staff and borrowers sign in on the same page and what each can open is decided by their
role's permissions. Tokens of the former borrower portal (`kind: "borrower"`) are rejected.

### Accounts for borrowers, My Books and emails

Public requests require an email. When staff **accept** a request (`POST /api/loans/:id/approve`), the borrower's
account is settled in the same transaction: an account already linked to them (`User.borrowerId`) is kept; else an
account with their email is linked; else a new account is created with the **default role** (`Role.isDefault`),
`BORROWER_DEFAULT_PASSWORD` and `mustChangePassword = true`. With no default role no account is created (a warning
is logged). After the transaction commits, the borrower is emailed — accepted: books, due date, where to pick them
up, and the sign-in link (plus the default password when this approval created the account; no sign-in part when
there is no account); rejected: the staff's reason. The result is stored on the borrow record (`notification` in
the API) and a failure never undoes the decision; **Resend email** (`POST /api/loans/:id/notify`) tries again.

These accounts are managed in **Users → Accounts** like every other account (password reset, role, deactivate).
The **My Books** module (`my_books.view`, in the default role) is `GET /api/me/loans`: the borrow records of the
borrower linked to the signed-in account. While `mustChangePassword` is set, the API answers every signed-in endpoint
except `/api/auth/*` and `GET /api/permissions` with 403 `PASSWORD_CHANGE_REQUIRED` (the default password is in every
acceptance email, so it must never open anyone's data), and the web app sends the user to change the password first
(`PATCH /api/auth/password` clears it and refuses `BORROWER_DEFAULT_PASSWORD`). The sign-in part of an email names the
linked account's email, and **Resend email** repeats the default password only while the account still has it.
`Borrower.passwordHash`, `mustChangePassword` and `tokenVersion` are deprecated: the migration
`20261104150000_one_account_system` moved those accounts to `User`, and the columns are kept (unused) until the
owner approves removing them.

Setting up email: put the SMTP settings in `.env` (see the table above) and restart the server. With Gmail, turn on
2-step verification, create an *app password*, and use `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`,
`SMTP_USER=<the address>`, `SMTP_PASS=<the app password>`, `MAIL_FROM="<Library name> <the address>"`. Without
`SMTP_HOST`, emails are printed in the backend terminal (handy for trying it out); tests never send email (they use
an in-memory outbox).

### Company profile

The name, tagline, logo and contact details shown on every page and in emails live in the `CompanyProfile` table
(exactly one row, created by its migration and by `npm run db:seed`; default name "Library System"). Staff with the
`company.update` permission edit it on the **Company Profile** page (`PUT /api/company`, `PUT|DELETE /api/company/logo`);
`GET /api/public/company` and `GET /api/public/company/logo` need no login.

### Roles and permissions

Every staff endpoint is gated by a permission (`requirePermission(...)` in the routers; catalog and `requires` rules in
`src/lib/permissions.ts`, documented in `docs/SPEC.md` → "Roles and permissions"). Nobody bypasses the check, not even
the Administrator role. `requireAuth` re-loads the user's role on every request, so permission changes apply
immediately. When adding an endpoint, gate it and add it to the table in `tests/guards.test.ts`.

## API errors

Every error is `{ "error": { "code", "message", "details"? } }` — codes are listed in `docs/SPEC.md`. In addition
to the spec's list, a body over the size limit returns **413 `PAYLOAD_TOO_LARGE`** (limit 100kb; 1mb for
`POST /api/books/bulk`; 2mb for `PUT /api/books/:id/cover`; 1mb for `PUT /api/company/logo`). Book pictures are stored in the database
(`BookCover`, one per book, deleted with the book) and served by `GET /api/books/:id/cover` to signed-in users with
`books.view`, and to everyone by the public catalog's `GET /api/public/libraries/:slug/books/:bookId/cover` (only for
non-archived books of a library whose public form is on). Unmapped foreign-key or write-conflict errors from a race return **409 `CONFLICT`**
(retryable) instead of 500.
