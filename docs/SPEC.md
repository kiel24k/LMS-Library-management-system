# Library System — Specification

## Terminology

The staff found that "loan" makes the system sound like borrowing **money** ("parang nangungutang ng pera"),
but people only borrow books here. So:

- **User-visible text never says "loan", "loans", "lend", "lending" or "lender"**: UI copy, page titles,
  `<title>`, aria-labels, placeholders, toasts, API error `message`s and the staff/public docs.
- **Internal names keep "loan"**: API paths (`/api/loans…`), JSON fields (`loanNumber`, `loanId`,
  `defaultLoanDays`, `activeLoans`, …), enum values, Prisma models/columns (`Loan`, `LoanItem`, `LoanStatus`),
  TypeScript names, file names and error **codes** (`BOOK_HAS_LOANS`, `BORROWER_HAS_LOANS`). In this spec,
  "loan" in technical sections means a borrow record.

| Internal | Shown to users |
|---|---|
| App name | the **company name** from the Company Profile (default **Library System**; staff with `company.update` change it, and the logo, on the **Company Profile** page) |
| a loan / `Loan` | a **borrow record** ("record" where obvious); "Borrow details", "Borrow record not found" |
| Loans (nav, page) | **Borrow Records** |
| New loan / Create loan | **Borrow Books** (page and button); staff form submit: **Confirm Borrow** |
| `loanNumber` | **reference number** / "Ref. no." (staff), **request number** (public form), e.g. `BR-000123` |
| Active loans / Active tab / open loan | **Currently borrowed** / **Borrowed** tab |
| On loan / out on loan | **borrowed** / currently borrowed |
| `defaultLoanDays` | **Default borrowing period (days)** |
| Loan history | **Borrowing history** |
| Open loans (of a borrower) | **Current borrows** |

Status labels: Pending, Borrowed, Partially returned, Returned, Rejected, Cancelled.
Toast examples: "Books borrowed (BR-000123)", "Request approved — books released".
Public requests are **accepted** or **rejected** (the staff UI says "Accept" / "Reject" for them; the API keeps
`approve` / `reject`). Emails to borrowers follow the same terminology.

## Problem

The library has no system. Staff struggle to register books and to track who borrowed
books and who returned them.

## Goals

1. **Register books by grouping, per library.** There can be several libraries, and each
   one has its own groupings (categories/sections, e.g. "Filipiniana", "Fiction", "Reference").
2. **Borrow form.** A borrower (or staff on their behalf) fills in a form: the borrower's name
   plus one or many books (with quantity). Each library chooses whether its form is
   **public** (anyone with the link can submit, no login) or **staff-only**.
3. **Return check.** When books come back, staff check the returned items against what was
   borrowed (right books, right quantities, condition) before the borrow record is closed. Each check records
   which staff member checked it and who brought the books back.
4. **Tracking.** The system always shows who borrowed what, what is still out, what is
   overdue, and the full history per borrower and per book.
5. **Online catalog and one account system.** The sign-in page links to a public catalog of the books that are
   available; visitors request books there with their **email (required)**. When staff accept or reject the
   request, the borrower is emailed. The first acceptance creates the borrower's account — an ordinary account
   (Users → Accounts) with the **default role**, linked to the borrower; default password, e.g. `password123`,
   written in the email, to be changed at the first sign-in. There is **one app** for everyone: borrowers sign in on
   the same page and see the books they borrowed on the **My Books** page in the sidebar (a module like any other,
   gated by `my_books.view`).
6. **Company profile.** The organisation's name, logo and contact details are editable (admin page **Company
   Profile**) and shown on every page and in emails, instead of a fixed "Library System".

Non-goals (for now): fines/payments, barcode scanning, SMS notifications, reminder/overdue emails (only the
accept/reject email of a public request is sent),
per-copy accession tracking (copies are counted, not individually identified),
per-library permissions (a role's permissions apply to every library).

---

## Tech

- `backend/`: Node 22, Express 5, TypeScript (ESM, `nodenext`), Prisma 7 (`prisma-client`
  generator → `src/generated/prisma`, `@prisma/adapter-pg`), PostgreSQL, zod validation,
  bcryptjs, jsonwebtoken, cookie-parser, helmet, express-rate-limit, nodemailer (SMTP). Tests: vitest + supertest.
- `frontend/`: Vite 8, React 19, TypeScript 7, Tailwind v4, shadcn/ui (style `base-nova`,
  components built on `@base-ui/react`), react-router v7, @tanstack/react-query,
  react-hook-form + zod, sonner toasts, lucide icons. Lint: oxlint.
- Dev: frontend on :5174 (strictPort; 5173 is used by other projects on the dev PC) proxies `/api` → backend on :3000 (same-origin, cookies just work).
  The Vite proxy target is read from env `API_PROXY_TARGET` (default `http://localhost:3000`) so tests can
  run the pair on other ports. The existing `GET /api/health` → `{ "status": "ok" }` (no auth) stays.

---

## Data model (Prisma)

IDs are `String @id @default(cuid())`. All models have `createdAt`/`updatedAt` unless noted.

```prisma
enum LoanStatus  { PENDING BORROWED PARTIALLY_RETURNED RETURNED REJECTED CANCELLED }
enum LoanSource  { STAFF PUBLIC_FORM }

model User {
  id           String   @id @default(cuid())
  email        String   @unique          // stored lower-cased
  name         String
  passwordHash String
  roleId       String                   // every user has exactly one role (onDelete: Restrict)
  active       Boolean  @default(true)
  tokenVersion Int      @default(0)      // copied into each JWT; bumped to sign the user out everywhere (see Auth)
  mustChangePassword Boolean @default(false) // true while the account still has a password it was given (the default
                                         // one from an acceptance email); cleared by PATCH /auth/password
  borrowerId   String?  @unique          // the borrower this account belongs to ("My Books"); onDelete: SetNull
  // relations: role, borrower, loansCreated, loansApproved, returnsReceived
}

model Role {                             // see "Roles and permissions"
  id          String   @id @default(cuid())
  name        String   @unique         // also UNIQUE (lower("name")) in the migration: unique regardless of case
  description String?
  permissions String[]                 // permission keys, normalized (requires added, catalog order)
  isDefault   Boolean  @default(false) // the role new accounts get; at most one (partial UNIQUE ("isDefault") WHERE "isDefault" in the migration)
  // relations: users
}

model Library {
  id                String  @id @default(cuid())
  name              String
  slug              String  @unique      // used in public form URL: /borrow/:slug
  description       String?
  location          String?
  publicFormEnabled Boolean @default(false)
  defaultLoanDays   Int     @default(7)  // 1..365
  // relations: categories, books, loans
}

model Category {                         // "grouping" inside a library
  id          String  @id @default(cuid())
  libraryId   String                     // onDelete: Cascade (Book/Loan → Library are onDelete: Restrict; see delete rules)
  name        String
  description String?
  @@unique([libraryId, name])            // plus, in a migration: UNIQUE ("libraryId", lower("name")) — names are
}                                        // unique per library regardless of case, enforced by the database

model Book {
  id              String   @id @default(cuid())
  libraryId       String
  categoryId      String?                // onDelete: SetNull
  title           String
  author          String?
  isbn            String?
  publisher       String?
  publicationYear Int?
  callNumber      String?                // shelf / call number
  totalCopies     Int      @default(1)   // >= 0 (>= 1 on create; may reach 0 through lost copies or PATCH)
  availableCopies Int      @default(1)   // 0..totalCopies, maintained atomically (see Stock rules)
  notes           String?
  archived        Boolean  @default(false)
  // relation: cover BookCover? (the book's picture)
  @@index([libraryId, categoryId])
  @@index([title])
}

model BookCover {                        // the book's picture, kept in the database (backed up with it; no upload folder)
  bookId    String   @id                 // onDelete: Cascade (deleting the book deletes its picture)
  mimeType  String                       // image/jpeg | image/png | image/webp (checked against the file's first bytes)
  data      Bytes                        // at most 1 MB; the frontend shrinks pictures to at most 800 px before upload
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Borrower {
  id                 String  @id @default(cuid())
  name               String
  idNumber           String? @unique              // student/employee/parishioner ID, optional
  contact            String?                      // phone or email
  affiliation        String?                      // e.g. "Grade 10 - St. Luke", "Faculty", "Parish youth"
  email              String? @unique              // trimmed + lower-cased; required on public requests; the accept/reject email goes here
  passwordHash       String?                      // DEPRECATED (unused): moved to User by 20261104150000_one_account_system;
  mustChangePassword Boolean @default(false)      // DEPRECATED (unused), same — the three columns keep their data until
  tokenVersion       Int     @default(0)          // DEPRECATED (unused), same — the owner approves removing them
  // relations: loans, user (User? — the linked account, see "Decision emails and accounts")
}

model Loan {
  id           String     @id @default(cuid())
  number       Int        @unique @default(autoincrement())  // shown as BR-000123 (reference number)
  libraryId    String
  borrowerId   String
  source       LoanSource
  status       LoanStatus
  requestedAt  DateTime   @default(now())
  borrowedAt   DateTime?                  // set when it becomes BORROWED
  dueDate      DateTime?  @db.Date        // set when it becomes BORROWED
  closedAt     DateTime?                  // set on RETURNED / REJECTED / CANCELLED
  notes        String?                    // borrower's or staff notes at creation
  staffNotes   String?                    // rejection / cancellation reason
  submittedName String?                   // PUBLIC_FORM only: borrower name exactly as typed (staff compare it
                                          // with borrower.name when the request was linked by idNumber)
  createdById  String?                    // staff who created it (null for public form)
  approvedById String?                    // staff who released the books (= createdById for staff-created loans)
  closedById   String?                    // staff who rejected / cancelled, or who recorded the final return
  notifiedAt   DateTime?                  // last successful accept/reject email (see "Decision emails")
  notifyError  String?                    // why the last accept/reject email failed (≤ 300 chars); null after a success
  @@index([libraryId, status])
  @@index([borrowerId])
}

model LoanItem {
  id               String @id @default(cuid())
  loanId           String                 // onDelete: Cascade
  bookId           String
  quantity         Int                    // >= 1
  returnedGood     Int    @default(0)
  returnedDamaged  Int    @default(0)
  lost             Int    @default(0)
  @@unique([loanId, bookId])              // one line per book per loan
}

model ReturnRecord {                      // one per return check (partial returns allowed)
  id           String   @id @default(cuid())
  loanId       String
  receivedById String                     // staff who checked it
  receivedAt   DateTime @default(now())
  returnedByName String?                  // person who physically brought the books back, if not the borrower
  notes        String?
  // relations: items
}

model ReturnRecordItem {
  id             String @id @default(cuid())
  returnRecordId String                   // onDelete: Cascade
  loanItemId     String
  good           Int    @default(0)
  damaged        Int    @default(0)
  lost           Int    @default(0)
}

model CompanyProfile {                    // exactly one row: id 1 (CHECK ("id" = 1) and the row itself come from the migration)
  id           Int      @id @default(1)
  name         String   @default("Library System")  // 1..120, one line
  tagline      String?                  // ≤ 200, one line
  address      String?                  // ≤ 300 (may span lines)
  contactEmail String?                  // ≤ 254
  contactPhone String?                  // ≤ 60, one line
  logoMimeType String?                  // image/png | image/jpeg | image/webp (checked against the file's first bytes)
  logoData     Bytes?                   // at most 512 KB
  updatedAt    DateTime @updatedAt      // (no createdAt)
}
```
The API copes with a missing CompanyProfile row (defaults; saving recreates it), and `npm run db:seed` re-creates it.

Derived values:
- `LoanItem.outstanding = quantity - returnedGood - returnedDamaged - lost` for loans that were borrowed
  (open or RETURNED); it is `0` for PENDING / REJECTED / CANCELLED loans (nothing is out yet / ever).
- `Book.onLoan = totalCopies - availableCopies` (copies currently out).
- Loan is **open** when status ∈ {BORROWED, PARTIALLY_RETURNED} ("Currently borrowed" / the "Borrowed" tab in the UI).
- Loan is **overdue** when it is open and `dueDate < today`,
  where "today" is the current date in `APP_TIMEZONE` (default `Asia/Manila`). `daysOverdue = today - dueDate`
  in whole days when overdue, else 0. All "today"/"this month" computations (defaults, validation, dashboard)
  use `APP_TIMEZONE`; the frontend never computes overdue itself.
- Default due date = today + `library.defaultLoanDays`, computed at the moment the loan becomes BORROWED.
- Display code (`loanNumber`, the "reference number" in the UI): `BR-` + number zero-padded to 6 digits
  (numbers > 999999 are not truncated). Wherever a reference number is accepted as input, the prefix is
  case-insensitive and optional, and the old `LN-` prefix is still accepted (printed slips and links made before the
  rename): `BR-000123`, `br-123`, `LN-000123`, `ln-123` and `123` are all equivalent.

Input normalization (backend, all endpoints): string inputs are trimmed; an empty string for an optional
field is stored as `null`; email is lower-cased. `Borrower.idNumber` matching is exact after trimming.

### Stock rules (must be race-safe)

All stock changes happen inside a Prisma `$transaction`, using conditional atomic updates
(e.g. `updateMany({ where: { id, availableCopies: { gte: q } }, data: { availableCopies: { decrement: q } } })`
and checking `count === 1`), so two concurrent loans can never take the same last copy.

| Event | Effect |
|---|---|
| Book created | `availableCopies = totalCopies` |
| Loan becomes BORROWED (staff-created, or PENDING approved) | `availableCopies -= quantity` for each item; fails with 409 `INSUFFICIENT_COPIES` (listing which books) if any book lacks copies; nothing changes on failure |
| PENDING loan created (public form) | no stock change (no reservation); requests for books with 0 available are still accepted — stock is checked at approval |
| Return: `good` / `damaged` | `availableCopies += good + damaged` |
| Return: `lost` | `totalCopies -= lost` (available unchanged, the copy was already out) |
| Book `totalCopies` edited by staff | `availableCopies += (new - old)`; rejected with 409 `COPIES_IN_USE` if result < 0 |
| Archived books | cannot be added to new loans, requests, or PENDING item edits (400 `INVALID_BOOKS`). A line already on a PENDING request whose book was archived later may stay in an item edit (its quantity may change), but the request cannot be approved until it is removed (400 `INVALID_BOOKS`), and once removed it cannot be added back. Archiving is allowed at any time and copies already out can still be returned |

Status changes and returns are race-safe the same way: transitions use a conditional update on the
current status (e.g. `updateMany({ where: { id, status: "PENDING" } })`, `count === 0` → 409 `INVALID_STATUS`),
and a return re-checks each item's `outstanding` inside the transaction, so a double-submitted return
check or a double approve can never apply twice.

### Status transitions

```
PUBLIC_FORM → PENDING ──approve──▶ BORROWED ──return(partial)──▶ PARTIALLY_RETURNED ──return──▶ RETURNED
                 │                     └────────────return(all)──────────────────────────────▶ RETURNED
                 ├──reject──▶ REJECTED
                 └──cancel──▶ CANCELLED
STAFF form ─────────────────▶ BORROWED (immediately; stock deducted)
```
A loan becomes RETURNED when every item's `outstanding` is 0 (lost items count as resolved).
Any other transition (e.g. approving a REJECTED loan, returning against a PENDING loan) → 409 `INVALID_STATUS`.

Fields set on each transition:
- Staff-created: `requestedAt = borrowedAt = now`, `createdById = approvedById = current user`, `dueDate` set.
- Approve: `borrowedAt = now`, `approvedById = current user`, `dueDate` = given or default; creates or links the
  borrower's account when needed, then sends the acceptance email (see "Decision emails and accounts").
- Reject / cancel: `closedAt = now`, `closedById = current user`, `staffNotes = reason` (if given). Reject sends the
  rejection email; cancel sends nothing.
- Final return (→ RETURNED): `closedAt = now`, `closedById = current user`.

### Delete rules
- Library: delete only if it has no books (archived included) and no loans (else 409 `LIBRARY_NOT_EMPTY`). Its categories are deleted with it.
- Category: delete allowed; its books get `categoryId = null`.
- Book: delete only if it never appeared in a loan; otherwise 409 `BOOK_HAS_LOANS` → archive instead.
- Borrower: delete only if no loans (else 409 `BORROWER_HAS_LOANS`).
- Users are never deleted, only deactivated. Deleting a borrower keeps their linked account (`borrowerId` becomes null).
- Loans are never deleted.

### Decision emails and accounts
- **One account system.** Staff and borrowers have the same kind of account (`User`, managed in Users → Accounts);
  there is no separate borrower login or portal. Public requests require an email, which identifies the borrower (see
  `POST /public/libraries/:slug/requests`). The first time one of their requests is accepted the borrower gets an
  account **linked** to them (`User.borrowerId`); they sign in on the normal sign-in page with that email, and what
  they can open is decided by the account's role (the default role includes **My Books**, `GET /me/loans`).
- **Accept** (`POST /loans/:id/approve`): inside the approval transaction, when the borrower has an email:
  1. an account is already linked to the borrower → nothing changes ("existing account");
  2. else an account with that email exists → it is linked (unless it already belongs to another borrower, then it
     stays theirs); its password and role are not touched ("existing account");
  3. else, when a **default role** exists (`Role.isDefault`) → a new account: that email, the borrower's name, the
     default role, `BORROWER_DEFAULT_PASSWORD` (bcrypt), `mustChangePassword = true`, linked ("account created"). The
     insert skips duplicates (`ON CONFLICT DO NOTHING`) and a skipped insert counts as an existing account, so two
     approvals at once create (and announce) it only once and never abort;
  4. no default role → no account (a warning is logged); the acceptance email then has no sign-in part.
  Accepted borrowers get exactly the default role's permissions — whoever accepts does not need to hold them.
- **Email after commit**, never inside a transaction, only when the borrower has an email: accept → acceptance email,
  reject → rejection email, cancel → nothing. The request waits for the send (bounded by ~10 s SMTP timeouts) and the
  outcome is stored on the loan: success → `notifiedAt = now`, `notifyError = null`; failure → `notifyError` (short,
  one line, ≤ 300 chars; logged with `console.error`). A failed email never undoes the decision.
- **Acceptance email** — subject `"<company name>: your borrow request BR-000123 was accepted"`; plain text + simple
  HTML (every interpolated value HTML-escaped): greeting with the borrower's name, reference number, library, the books
  (title, "by author", "(N copies)"), due date ("Tuesday, 10 November 2026" — the calendar date, never shifted by time
  zone), where to pick them up (library name and location) and an account block:
  - account created by this approval: "You can now sign in at `<APP_PUBLIC_URL>/login` with your email `<email>` and
    the default password: `<BORROWER_DEFAULT_PASSWORD>`" + "Please change this password after you sign in.";
  - existing account: "Sign in at `<APP_PUBLIC_URL>/login` with your email `<email>` and your password to see your
    borrowed books.";
  - `<email>` is the linked **account's** email (the one that signs in), which can differ from the borrower's after a
    borrower edit (editing a borrower never changes the account); the email itself still goes to the borrower's email;
  - no account (no default role): no sign-in part.
- **Rejection email** — subject `"<company name>: your borrow request BR-000123 was not accepted"`: reference number,
  library, books requested, "Reason: <staff's reason>", an invitation to contact the library. No account is created.
- Both end with a footer from the Company Profile: name, address, contact email and phone (when set). Sender:
  `MAIL_FROM` when it holds an address; otherwise its name (or the company name) at `SMTP_USER` when that is an email
  address, else at `no-reply@localhost`.
- **Resend** (`POST /loans/:id/notify`) never creates or links an account; it repeats the default-password block only
  while the linked account still has `mustChangePassword = true` (e.g. never signed in) **and** its password still is
  `BORROWER_DEFAULT_PASSWORD` (not after an admin set another one, or after the env value changed — then the
  "existing account" block), and has no sign-in part when the borrower has no linked account.
- **Mail transport**: SMTP via nodemailer when `SMTP_HOST` is set; otherwise nothing leaves the machine — in
  development the email is printed to the backend console and recorded as NOT sent (`notifyError` says SMTP is not set
  up, so staff can resend once it is); under `NODE_ENV=test` it is kept in an in-memory outbox (`src/lib/mailer.ts`
  `testOutbox`; always, even with SMTP configured) and counts as sent.

---

## API

Base `/api`. JSON only. Errors: `{ "error": { "code": string, "message": string, "details"?: any } }`
with proper HTTP status (see **Error codes** below). `message` is human-readable English, safe to show in a toast,
and follows **Terminology** (e.g. "Borrow record not found", never "Loan not found"); `code`s are unchanged.

Conventions (both sides rely on these):
- **Single resources** are returned bare (the object itself, no wrapper) — except auth, which returns `{ user }`.
  Create → **201** with the created resource; update/action → **200** with the updated resource;
  delete → **204** (no body).
- **Paginated lists** (`GET /books`, `/borrowers`, `/loans`, `/public/libraries/:slug/books`):
  `?page=1&pageSize=20` (page ≥ 1, pageSize 1–100 — public books 1–50; out of range → 400) → `{ data: T[], total, page, pageSize }`.
  A page past the end returns `data: []` with the real `total`.
- **Unpaginated lists** (`GET /libraries`, `/libraries/:libraryId/categories`, `/users`) → `{ data: T[] }`.
- Query booleans are the strings `true`/`false`; an omitted filter means "no filter".
- PATCH is partial: omitted fields are unchanged; nullable fields accept `null` to clear.
- Dates in responses: ISO 8601 UTC strings; `dueDate` (input and output) as `YYYY-MM-DD`.
  Optional/nullable fields are always present in responses with `null`, never omitted.
- Unknown `/api/*` route → 404 `NOT_FOUND`.

### Response shapes

TypeScript notation; the frontend's `src/types/api.ts` copies these verbatim.

```ts
type ISODateTime = string;              // "2026-11-03T02:15:00.000Z"
type DateOnly = string;                 // "2026-11-10"
type Ref = { id: string; name: string };
type LoanStatus = "PENDING" | "BORROWED" | "PARTIALLY_RETURNED" | "RETURNED" | "REJECTED" | "CANCELLED";

type User = {
  id: string; email: string; name: string; role: Ref; active: boolean;
  mustChangePassword: boolean;  // must change the password before using the app (API: 403 PASSWORD_CHANGE_REQUIRED; the frontend sends them to /account)
  borrower: Ref | null;         // the linked borrower (whose records "My Books" shows); null = not linked
  createdAt: ISODateTime;
};
type Me = User & { permissions: Permission[] };   // POST /auth/login, GET /auth/me (Permission = a catalog key)

type RoleDetail = {
  id: string; name: string; description: string | null;
  permissions: Permission[];  // normalized, catalog order
  userCount: number;          // accounts with this role (active or not)
  isDefault: boolean;         // the default role for new accounts (at most one role)
  createdAt: ISODateTime; updatedAt: ISODateTime;
};
type PermissionModule = {
  key: string; label: string;
  permissions: { key: Permission; label: string; description: string | null; requires: Permission[] }[];
};

type Library = {
  id: string; name: string; slug: string; description: string | null; location: string | null;
  publicFormEnabled: boolean; defaultLoanDays: number; createdAt: ISODateTime; updatedAt: ISODateTime;
  counts: {
    books: number;            // non-archived books
    copies: number;           // sum totalCopies of non-archived books
    available: number;        // sum availableCopies of non-archived books
    activeLoans: number;      // open loans (BORROWED + PARTIALLY_RETURNED)
    pendingRequests: number;  // PENDING loans
    categories: number;
  };
};

type Category = { id: string; libraryId: string; name: string; description: string | null; bookCount: number }; // bookCount: non-archived

type Book = {
  id: string; libraryId: string; library: Ref; categoryId: string | null; category: Ref | null;
  title: string; author: string | null; isbn: string | null; publisher: string | null;
  publicationYear: number | null; callNumber: string | null;
  totalCopies: number; availableCopies: number; onLoan: number;
  notes: string | null; archived: boolean; createdAt: ISODateTime; updatedAt: ISODateTime;
  coverUrl: string | null;    // "/api/books/<id>/cover?v=<cover updatedAt in ms>" when the book has a picture, else null;
                              // ?v= changes with every new picture, so browsers may cache each URL for good
};
type BookDetail = Book & {
  currentLoans: {             // open loans that still have this book outstanding, oldest dueDate first
    loanId: string; loanNumber: string; status: LoanStatus; borrower: Ref;
    quantity: number; outstanding: number; dueDate: DateOnly; isOverdue: boolean;
  }[];
};                            // full loan history: GET /loans?bookId=…

type Borrower = {
  id: string; name: string; idNumber: string | null; contact: string | null; affiliation: string | null;
  email: string | null;
  hasAccount: boolean;          // an account is linked to this borrower (User.borrowerId)
  mustChangePassword: boolean;  // the linked account still has to change its password (false without an account)
  account: { id: string; email: string; role: Ref; active: boolean } | null;  // the linked account
  createdAt: ISODateTime; updatedAt: ISODateTime;
  activeLoans: number;        // open loans
  outstandingCopies: number;  // sum of outstanding over open loans
};
type BorrowerDetail = Borrower & { loans: Loan[] };   // all loans, newest first

type LoanItem = {
  id: string; bookId: string;
  book: { id: string; title: string; author: string | null; callNumber: string | null; archived: boolean;
          totalCopies: number; availableCopies: number }; // current stock (shown on pending requests)
  quantity: number; returnedGood: number; returnedDamaged: number; lost: number; outstanding: number;
};

type Loan = {                 // list item (GET /loans, dashboard, borrower detail)
  id: string; number: number; loanNumber: string;   // 123, "BR-000123"
  libraryId: string; library: Ref;
  borrower: { id: string; name: string; email: string | null; idNumber: string | null; contact: string | null; affiliation: string | null };
  source: "STAFF" | "PUBLIC_FORM"; status: LoanStatus;
  requestedAt: ISODateTime; borrowedAt: ISODateTime | null; dueDate: DateOnly | null; closedAt: ISODateTime | null;
  notes: string | null; staffNotes: string | null; submittedName: string | null;
  notification: { sentAt: ISODateTime | null; error: string | null } | null;  // accept/reject email (notifiedAt /
                              // notifyError); null when none was ever attempted
  items: LoanItem[];
  totalQuantity: number;      // sum of item quantities
  outstandingTotal: number;   // sum of item outstanding
  isOverdue: boolean; daysOverdue: number;
};
type LoanDetail = Loan & {
  createdBy: Ref | null; approvedBy: Ref | null; closedBy: Ref | null;
  returns: ReturnRecord[];    // oldest first
};
type ReturnRecord = {
  id: string; receivedAt: ISODateTime; receivedBy: Ref; returnedByName: string | null; notes: string | null;
  items: { id: string; loanItemId: string; bookId: string; bookTitle: string; good: number; damaged: number; lost: number }[];
};

type Dashboard = {
  totals: { books: number; copies: number; available: number; borrowedOut: number }; // books/copies/available as Library.counts; borrowedOut = sum outstanding over open loans
  loans: { pending: number; active: number; overdue: number; returnedThisMonth: number }; // returnedThisMonth: RETURNED with closedAt in current calendar month
  overdueLoans: Loan[];       // top 10, oldest dueDate first
  pendingLoans: Loan[];       // top 10, oldest requestedAt first (waiting longest)
  recentActivity: {           // latest 15, newest first
    type: "REQUESTED" | "BORROWED" | "RETURNED" | "REJECTED" | "CANCELLED";
    loanId: string; loanNumber: string; borrowerName: string; libraryName: string;
    at: ISODateTime; byName: string | null;   // staff name; null for REQUESTED
  }[];
};
```
Activity events are derived, not stored: REQUESTED = PUBLIC_FORM loan at `requestedAt`; BORROWED = any loan at
`borrowedAt` (by approvedBy); RETURNED = **each** ReturnRecord at `receivedAt` (by receivedBy, partial or final);
REJECTED / CANCELLED at `closedAt` (by closedBy).

```ts
type CompanyProfile = {        // GET /public/company, PUT /company, PUT|DELETE /company/logo
  name: string; tagline: string | null; address: string | null; contactEmail: string | null; contactPhone: string | null;
  logoUrl: string | null;      // "/api/public/company/logo?v=<updatedAt ms>" when there is a logo
};
type PublicLibrarySummary = { name: string; slug: string; description: string | null; location: string | null; defaultLoanDays: number };
type MyLoansResponse = {       // GET /me/loans ("My Books")
  borrower: Ref | null;        // the borrower linked to the signed-in account; null (and no data) when not linked
  data: PortalLoan[];
};
type PortalLoan = {            // what an account sees of its linked borrower's own records
  id: string; loanNumber: string; status: LoanStatus; library: { name: string; slug: string };
  requestedAt: ISODateTime; borrowedAt: ISODateTime | null; dueDate: DateOnly | null; closedAt: ISODateTime | null;
  isOverdue: boolean; daysOverdue: number;
  staffNotes: string | null;   // the reason, only when REJECTED (cancellation notes stay internal)
  items: { bookId: string; title: string; author: string | null; quantity: number; outstanding: number }[];
};
```

### Error codes

| Status | `code` | When / `details` |
|---|---|---|
| 400 | `VALIDATION_ERROR` | body/query fails zod; `details: { issues: [{ path: (string\|number)[], message: string }] }` (e.g. path `["books", 3, "title"]` in bulk, `["items", 0, "quantity"]`) |
| 400 | `INVALID_BOOKS` | a book doesn't exist, is in another library, or is archived; `details: { bookIds: string[] }` |
| 400 | `INVALID_CATEGORY` | category doesn't belong to the book's library |
| 400 | `RETURN_EXCEEDS_OUTSTANDING` | `details: { loanItemIds: string[] }` |
| 400 | `WRONG_PASSWORD` | `PATCH /auth/password` with wrong `currentPassword` |
| 400 | `NO_EMAIL` | `POST /loans/:id/notify` for a borrower without an email |
| 400 | `INVALID_IMAGE` | `PUT /books/:id/cover`: not a `data:image/jpeg\|png\|webp;base64,…` URL; `PUT /company/logo`: bad `data`; either: bad base64, or first bytes that do not match the stated type |
| 401 | `INVALID_CREDENTIALS` | login with wrong email/password or inactive user (same message for all) |
| 401 | `UNAUTHENTICATED` | missing/invalid/expired token (including tokens of the former borrower portal), or user deactivated |
| 403 | `PASSWORD_CHANGE_REQUIRED` | the signed-in user must still change the password they were given (`mustChangePassword`); every signed-in endpoint except `/auth/*` and `GET /permissions` |
| 403 | `FORBIDDEN` | the user's role lacks the endpoint's permission (for `PATCH /users/:id`: lacks the permission of any field sent; for `PATCH /books/:id`: `archived` needs books.delete, the other fields books.update; a new grouping typed into a book `categoryName` needs categories.create, a new borrower entered in `POST /loans` needs borrowers.create) |
| 403 | `PERMISSION_ESCALATION` | creating/editing a role that would gain, or giving an account a role that holds (including the default role when `POST /users` has no `roleId`), a permission the actor does not have; making a role the default when it holds a permission the actor does not have; resetting the password of, (de)activating or changing the role of another account whose role holds a permission the actor does not have |
| 404 | `NOT_FOUND` | unknown id/slug/route, or public form disabled |
| 409 | `INSUFFICIENT_COPIES` | `details: { books: [{ bookId, title, requested, available }] }` |
| 409 | `INVALID_STATUS` | action not allowed in the loan's current status; `details: { status }` |
| 409 | `SLUG_TAKEN` · `CATEGORY_EXISTS` · `EMAIL_TAKEN` · `ID_NUMBER_TAKEN` | uniqueness (category names unique per library, case-insensitive; `EMAIL_TAKEN` for accounts and for borrower emails: "Another borrower already has this email.") |
| 409 | `EMAIL_MISMATCH` | public request whose ID number belongs to a borrower with a different email |
| 409 | `NOT_LINKED` | `POST /me/requests` from an account that isn't linked to a borrower |
| 409 | `LIBRARY_NOT_EMPTY` · `BOOK_HAS_LOANS` · `BORROWER_HAS_LOANS` | delete rules |
| 409 | `COPIES_IN_USE` | `totalCopies` edit would make `availableCopies` < 0 |
| 409 | `ROLE_NAME_TAKEN` | role names are unique, case-insensitive |
| 409 | `ROLE_IN_USE` | deleting a role that an account (active or not) still has |
| 409 | `ROLE_IS_DEFAULT` | deleting the default role for new accounts ("Make another role the default first.") |
| 409 | `SELF_MODIFICATION` | deactivating yourself or changing your own role |
| 409 | `ACCESS_LOCKOUT` | the change would leave no active account able to manage users and roles (see Roles and permissions) |
| 409 | `CONFLICT` | safety net: the data changed underneath the request in a way no specific code covers (e.g. a rare concurrent write conflict); retrying usually succeeds. Known races (e.g. a book, borrower, library or grouping deleted while a loan or book is being created) return their specific code instead (`INVALID_BOOKS`, `NOT_FOUND`, `INVALID_CATEGORY`, `CATEGORY_EXISTS`, …) |
| 413 | `PAYLOAD_TOO_LARGE` | request body over the size limit (see Security) |
| 413 | `IMAGE_TOO_LARGE` | `PUT /books/:id/cover`: the decoded picture is over 1 MB; `PUT /company/logo`: over 512 KB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | state-changing request without `Content-Type: application/json` |
| 429 | `RATE_LIMITED` | rate limit hit |
| 500 | `INTERNAL_ERROR` | unexpected error (no stack traces in the body) |

### Auth (cookie `lms_token`, httpOnly, SameSite=Lax, Secure in production, JWT 7d, `JWT_SECRET` env)
- `POST /auth/login` `{email, password}` → 200 `{ user: Me }` + sets cookie (rate-limited: 10 **failed** attempts / 15 min / IP; successful logins are not counted, because staff at one site usually share a public IP). Wrong credentials or inactive user → 401 `INVALID_CREDENTIALS`.
  Everyone signs in here — staff and borrowers have the same kind of account (see "Decision emails and accounts").
  One bcrypt comparison runs on every path (a dummy hash for unknown emails), so timing does not reveal which emails
  exist.
- `POST /auth/logout` → 204, clears cookie (also 204 when not logged in). It also ends the session server-side:
  the token (and any copy of it) stops working, and so do the user's sessions on other devices.
- `GET /auth/me` → `{ user: Me }` or 401 `UNAUTHENTICATED`. On every authenticated request the user **and their
  role's permissions** are re-loaded, so a permission or role change applies on the very next request (no new sign-in);
  deactivated users get 401. A role without any permissions can still sign in (it just cannot open anything).
- `PATCH /auth/password` `{currentPassword, newPassword}` (min 8 characters, max 72 **bytes** in UTF-8 — bcrypt ignores
  anything longer; plain ASCII = 72 characters, accented letters take 2 bytes, emoji 4) → 204 and a fresh cookie:
  the current session stays signed in, every other session of that user is signed out. It also clears
  `mustChangePassword`; while that flag is set, `newPassword` equal to `BORROWER_DEFAULT_PASSWORD` → 400
  `VALIDATION_ERROR` (path `["newPassword"]`, "Choose a password other than the default one.").
- **Forced password change is enforced by the API**: while the signed-in user's `mustChangePassword` is set, every
  signed-in endpoint answers 403 `PASSWORD_CHANGE_REQUIRED` ("Change your password before you continue."), before any
  permission check — except `/auth/*` (`GET /auth/me`, `POST /auth/logout`, `PATCH /auth/password`) and the static
  `GET /permissions` catalog. The default password is in every acceptance email, so knowing it must never open
  anyone's data; the web app sends the user to `/account?change-password=1` first.
- Sessions: each JWT carries the user's `tokenVersion`, which must still match on every request (else 401
  `UNAUTHENTICATED`). It is bumped by logout, the user's own password change, a password reset (users.reset_password) and
  deactivation, so all earlier tokens of that user stop working immediately (not only after 7 days).
- `user` shape: `Me` (see Response shapes; never the hash). Auth endpoints need no permission (changing your own password included).
- JWT claims are `{ sub: userId, ver: tokenVersion }`. Tokens with a `kind` claim (issued by the former borrower
  portal, `kind: "borrower"`) are always rejected with 401.

### Roles and permissions
Role-based access control: **every** staff endpoint (and every page, button and menu item in the frontend) requires a
permission. Roles are records holding a set of permissions; every account has exactly one role. Nobody bypasses the
checks — the **Administrator** role is just a role that happens to hold every permission. Missing permission →
403 `FORBIDDEN` "You do not have permission to do this."

Catalog (single source of truth `backend/src/lib/permissions.ts`, mirrored as a type in `frontend/src/lib/permissions.ts`;
order = display order; *requires* = granted together with it automatically):

| Module (label) | Permissions (requires) |
|---|---|
| `dashboard` (Dashboard) | `dashboard.view` |
| `libraries` (Libraries) | `libraries.view` · `libraries.create` / `libraries.update` (details, loan days, public form on/off) / `libraries.delete` (libraries.view) |
| `categories` (Groupings) | `categories.create` / `categories.update` / `categories.delete` (libraries.view) |
| `books` (Books) | `books.view` · `books.create` (incl. Add many) / `books.update` (details, copies, pictures) / `books.delete` (delete and archive/restore) (books.view) |
| `borrowers` (Borrowers) | `borrowers.view` · `borrowers.create` / `borrowers.update` / `borrowers.delete` (borrowers.view) |
| `loans` (Borrow Records) | `loans.view` · `loans.create` (loans.view, books.view, borrowers.view) · `loans.update` (loans.view, books.view) · `loans.approve` (approve/reject) / `loans.cancel` / `loans.return` (loans.view) |
| `users` (Users) | `users.view` · `users.create` / `users.update` (name and role) (users.view, roles.view) · `users.deactivate` / `users.reset_password` (users.view) |
| `roles` (Roles & Permissions) | `roles.view` · `roles.create` / `roles.update` / `roles.delete` (roles.view) |
| `company` (Company Profile) | `company.update` (name, logo and contact details shown on every page and in emails) |
| `my_books` (My Books) | `my_books.view` (the My Books page: the borrow records of the borrower linked to the signed-in account) |

- Stored permission lists are **normalized**: deduplicated, every `requires` added (transitively), catalog order.
  Unknown keys in a request → 400 `VALIDATION_ERROR` (path `["permissions", i]`).
- `GET /permissions` → `{ data: PermissionModule[] }` — any signed-in user (to render the permission tree).
- `GET /roles` (roles.view) → `{ data: RoleDetail[] }` (sorted by name, case-insensitive) · `GET /roles/:id` (roles.view) → `RoleDetail` ·
  `POST /roles` (roles.create; with `isDefault: true` also roles.update, else 403 `FORBIDDEN`) `{ name (1–60), description? (≤200), permissions: Permission[], isDefault?: true }` → 201 `RoleDetail` ·
  `PATCH /roles/:id` (roles.update) `{ name?, description?, permissions?, isDefault?: true }` → `RoleDetail` ·
  `DELETE /roles/:id` (roles.delete) → 204; 409 `ROLE_IS_DEFAULT` for the default role; 409 `ROLE_IN_USE` while any
  account (active or not) has it.
  Duplicate name (case-insensitive) → 409 `ROLE_NAME_TAKEN`.
- **Default role for new accounts** (`Role.isDefault`, at most one role; enforced by a partial unique index):
  `POST /users` without `roleId` gives the new account this role. `isDefault: true` on `POST /roles` or
  `PATCH /roles/:id` makes that role the default and clears the flag on every other role, in one transaction
  (serialized with the advisory lock below, so concurrent requests always end with exactly one default). Only `true`
  is accepted: `isDefault: false` → 400 `VALIDATION_ERROR` "Choose another role as the default instead." (a role stops
  being the default when another role becomes it). The actor must hold every permission of the role (as it is after
  the request), else 403 `PERMISSION_ESCALATION` "You can't make a role the default if it has permissions you don't
  have."; re-sending `isDefault: true` for the current default changes nothing. The migration that added the flag and
  the seed make **Staff** the default when no role is.
- **No escalation** (403 `PERMISSION_ESCALATION` "You can't grant permissions you don't have."): creating a role
  needs every permission of its (normalized) set; editing a role needs every permission being **added** (ones it already
  has may stay or be removed); giving an account a role (create, or a role change) needs every permission of that role.
  Resetting the password of, (de)activating or changing the role of **another** account also needs every permission
  that account's current role holds ("You can't change an account that has permissions you don't have."), so a
  lesser account can't take over or lock out a more powerful one (renaming is not limited).
- **Lock-out guard** (409 `ACCESS_LOCKOUT` "At least one active account must be able to manage users and roles."):
  after a change that can reduce access (editing a role's permissions, changing an account's role, deactivating an
  account) at least one **active** account must still hold `users.view`, `users.update`, `roles.view` and
  `roles.update`. These changes are serialized with a transaction-level advisory lock (`pg_advisory_xact_lock`), so
  two concurrent changes cannot both pass the check.
- Built-in roles (created by the migration that introduced roles, and by the seed if missing): **Administrator**
  (every permission; former ADMIN accounts) and **Staff** (everything except `libraries.create/update/delete`,
  `users.*`, `roles.*` and `company.update` — so it includes `my_books.view`; former STAFF accounts; the default role
  for new accounts, and so for accepted borrowers, unless another role is made the default). The migration that added
  `company.update` granted it to every role that already held `roles.update`; the migration that added
  `my_books.view` (`20261104150000_one_account_system`) granted it to the default role and to every role holding
  `roles.update`.

### Staff endpoints (require login; the permission each endpoint needs is in parentheses)
- **Libraries**: `GET /libraries` (any signed-in user — reference data for the library switcher and pickers) → `{ data: Library[] }` (all libraries, sorted by name) ·
  `POST /libraries` (libraries.create) · `GET /libraries/:id` (libraries.view) → `Library` · `PATCH /libraries/:id` (libraries.update) · `DELETE /libraries/:id` (libraries.delete).
  `LibraryInput = { name (1–120), slug?, description? (≤1000), location? (≤200), publicFormEnabled? (default false), defaultLoanDays? (1–365, default 7) }`.
  Slug: lowercase `a-z0-9-`, 3–60 chars, unique (409 `SLUG_TAKEN`); if omitted on create it is generated from
  the name (padded/suffixed `-2`, `-3`… to be valid and unique). Changing the slug changes the public link.
- **Categories**: `GET /libraries/:libraryId/categories` (any signed-in user) → `{ data: Category[] }` (sorted by name) ·
  `POST /libraries/:libraryId/categories` (categories.create) `{ name (1–80), description? (≤500) }` → `Category` ·
  `PATCH /categories/:id` (categories.update) · `DELETE /categories/:id` (categories.delete). Name unique per library, case-insensitive (409 `CATEGORY_EXISTS`).
- **Books** (reading — list, detail, picture — books.view; `POST /books` and `POST /books/bulk` books.create;
  `PATCH /books/:id` and `PUT`/`DELETE /books/:id/cover` books.update, except that `archived` in `PATCH /books/:id`
  needs books.delete instead; `DELETE /books/:id` books.delete):
  `GET /books?libraryId&categoryId&q&available=true&includeArchived=true&page&pageSize` → paginated `Book`
  (sorted by title; `q` matches title/author/isbn/callNumber, case-insensitive substring; `available=true` → `availableCopies > 0`;
  archived books excluded unless `includeArchived=true`) · `POST /books` `BookInput & { libraryId }` → `Book` ·
  `POST /books/bulk` `{ libraryId, books: BookInput[] }` (1–500 rows; all-or-nothing; category given by
  `categoryName`, matched case-insensitively within the library, created if missing) → 201 `{ created: number, categoriesCreated: string[] }` ·
  `GET /books/:id` → `BookDetail` ·
  `PATCH /books/:id` (any `BookInput` field plus `archived`; `libraryId` cannot change; `totalCopies` int 0–10000 per Stock rules) → `Book`
  (archiving or restoring — the `archived` field — needs books.delete, "Delete / archive books"; every other field
  books.update; one missing permission rejects the whole request with 403 `FORBIDDEN`) ·
  `DELETE /books/:id` ·
  **Picture**: `PUT /books/:id/cover` `{ image: string }` (a `data:image/jpeg|png|webp;base64,…` URL; decoded at most
  1 MB, else 413 `IMAGE_TOO_LARGE`; another type, bad base64, or first bytes that do not match the stated type → 400
  `INVALID_IMAGE`) → `Book` (replaces any old picture) · `DELETE /books/:id/cover` → `Book` (no picture is fine) ·
  `GET /books/:id/cover` → the image bytes with its `Content-Type` and `Cache-Control: private, max-age=31536000,
  immutable` (404 `NOT_FOUND` when the book or its picture does not exist). Archived books keep their picture.
  Pictures need books.view (not on public endpoints).
  `BookInput = { title (1–300), author? (≤200), isbn? (≤40), publisher? (≤200), publicationYear? (int 1000–9999), callNumber? (≤100), totalCopies (int 1–10000, default 1), categoryId? | categoryName?, notes? (≤1000) }`
  (send at most one of `categoryId` / `categoryName`; on single create/PATCH `categoryName` also matches-or-creates).
  Creating a grouping this way needs categories.create (403 `FORBIDDEN` otherwise, nothing is saved); matching an
  existing one does not.
  A book's category must belong to the same library (400 `INVALID_CATEGORY`).
- **Borrowers** (`GET` list/detail borrowers.view; `POST` borrowers.create; `PATCH` borrowers.update; `DELETE` borrowers.delete):
  `GET /borrowers?q&hasAccount&page&pageSize` → paginated `Borrower` (sorted by name; `q` matches name/idNumber/contact/email, case-insensitive; `hasAccount=true|false` keeps only borrowers with / without a linked account) ·
  `POST /borrowers` `BorrowerInput` → `Borrower` · `GET /borrowers/:id` → `BorrowerDetail` ·
  `PATCH /borrowers/:id` · `DELETE /borrowers/:id`.
  `BorrowerInput = { name (2–120), idNumber? (≤50), contact? (≤120), affiliation? (≤120), email? (name@host, ≤254, trimmed + lower-cased; "" → null) }`;
  duplicate `idNumber` → 409 `ID_NUMBER_TAKEN`; duplicate `email` → 409 `EMAIL_TAKEN`. `q` also matches the email.
  Editing a borrower (email included, also removing it) never touches their linked account: accounts — including
  borrowers' — are managed in Users → Accounts (`PATCH /users/:id`: password reset, role, deactivate).
- **Loans** (`POST /loans` and every POST/PATCH on `/loans/:id` respond with the resulting `LoanDetail`; `GET` list/detail
  loans.view, `POST /loans` loans.create, `PATCH /loans/:id` loans.update, approve and reject loans.approve, cancel
  loans.cancel, returns loans.return):
  - `GET /loans?libraryId&status&borrowerId&bookId&overdue=true&q&page&pageSize` → paginated `Loan`.
    `status` accepts one value or a comma-separated list (e.g. `BORROWED,PARTIALLY_RETURNED`); `overdue=true` → only overdue loans;
    `bookId` → loans containing that book. `q` matches borrower name/idNumber (case-insensitive substring) or reference
    number (any accepted form: `BR-`, `LN-` or bare number). Sorted by `requestedAt` desc (newest first).
  - `POST /loans` (staff form) `{ libraryId, borrowerId | borrower: BorrowerInput, items: [{bookId, quantity}], dueDate?, notes? (≤500) }`
    → 201, creates a **BORROWED** loan (`source = STAFF`), deducts stock. Exactly one of `borrowerId` / `borrower`;
    sending `borrower` also needs borrowers.create (403 `FORBIDDEN`).
    If `borrower.idNumber` matches an existing borrower, that borrower is used (their details, email included, are not
    overwritten); otherwise a new borrower is created (an `email` already used by another borrower → 409 `EMAIL_TAKEN`). Items: 1–50 distinct books (duplicate `bookId` → 400), quantity 1–100,
    all in `libraryId` and non-archived (else 400 `INVALID_BOOKS`). `dueDate` ≥ today, default per Derived values.
  - `GET /loans/:id` → `LoanDetail`.
  - `PATCH /loans/:id` `{ items?, notes?, dueDate? }`: `items` (full replacement list, same rules as `POST /loans`, except that a
    book already on the request that has since been archived may stay in the list — only newly added books must be non-archived;
    approval still rejects it until it is removed) only while PENDING; `dueDate` (≥ today; used to extend a loan) only while BORROWED or PARTIALLY_RETURNED; `notes` while not closed.
    Anything else → 409 `INVALID_STATUS`.
  - `POST /loans/:id/approve` `{ dueDate? }` — PENDING → BORROWED (stock check, 409 `INSUFFICIENT_COPIES`; archived
    books → 400 `INVALID_BOOKS`; staff can then reduce/remove items via PATCH and approve again). `dueDate` ≥ today,
    default per Derived values.
    The borrower's account is created or linked in the same transaction, then the acceptance email is sent — see
    "Decision emails and accounts"; the response already contains the result in `notification`.
  - `POST /loans/:id/reject` `{ reason (1–500) }` — PENDING → REJECTED, then sends the rejection email.
  - `POST /loans/:id/notify` (loans.approve) `{}` → `LoanDetail` — sends the accept/reject email again (e.g. after an
    SMTP failure). Only for `PUBLIC_FORM` records that were accepted (BORROWED, PARTIALLY_RETURNED, RETURNED) or REJECTED,
    else 409 `INVALID_STATUS`; borrower without email → 400 `NO_EMAIL`. Never creates or links an account; repeats the
    default password only while the linked account still has `mustChangePassword` and that password (see "Decision
    emails and accounts").
  - `POST /loans/:id/cancel` `{ reason? (≤500) }` — PENDING → CANCELLED (e.g. borrower withdrew / never came).
  - `POST /loans/:id/returns` `{ items: [{ loanItemId, good, damaged, lost }], returnedByName? (≤120), notes? (≤500) }` → 200 `LoanDetail` —
    only for BORROWED/PARTIALLY_RETURNED. Every `loanItemId` must belong to this loan and appear at most once (else 400
    `VALIDATION_ERROR`); items not listed count as 0. Each count is an int ≥ 0, at least one count > 0 overall, and per item
    `good+damaged+lost ≤ outstanding` (else 400 `RETURN_EXCEEDS_OUTSTANDING`). Creates a ReturnRecord (receivedBy = current user),
    updates LoanItems, stock, and loan status (PARTIALLY_RETURNED, or RETURNED + `closedAt`/`closedById` when nothing is outstanding).
- **Dashboard** (dashboard.view): `GET /dashboard?libraryId` → `Dashboard` (all libraries when `libraryId` omitted).
- **Company profile** (company.update): `PUT /company` `{ name (1–120, one line), tagline? (≤200, one line), address? (≤300),
  contactEmail? (name@host, ≤254), contactPhone? (≤60, one line) }` → `CompanyProfile` (optional fields: string or
  null, "" → null; an omitted optional field is left unchanged) ·
  `PUT /company/logo` `{ mimeType: "image/png" | "image/jpeg" | "image/webp", data: <base64> }` (a `data:<mimeType>;base64,`
  prefix is tolerated; decoded at most 512 KB, else 413 `IMAGE_TOO_LARGE`; bad base64 or first bytes that do not match
  `mimeType` → 400 `INVALID_IMAGE`) → `CompanyProfile` · `DELETE /company/logo` → `CompanyProfile` (no logo is fine).
- **Users** (the **Accounts** tab: staff and borrowers alike; `User.borrower` shows the linked borrower):
  `GET /users` (users.view) → `{ data: User[] }` (sorted by name) ·
  `POST /users` (users.create) `{email, name (1–120), password (8 characters – 72 bytes, as for `PATCH /auth/password`), roleId?}` → 201 `User`
  (unknown `roleId` → 400 `VALIDATION_ERROR` on `roleId`, "Role not found."; no `roleId` → the default role, or 400
  `VALIDATION_ERROR` on `roleId` "Choose a role (no default role is set)." when there is none; the no-escalation rule
  applies to the resolved role) ·
  `PATCH /users/:id` `{name?, roleId?, active?, password?}` → `User` (password = password reset; email is immutable).
  Each field needs its own permission: `name`/`roleId` users.update, `active` users.deactivate, `password`
  users.reset_password; if any is missing the whole request is rejected with 403 `FORBIDDEN` and nothing changes
  (the route itself needs at least one of the three).
  A password reset or deactivation signs that user out everywhere (when users reset their own password, their
  current session gets a fresh cookie and stays signed in). A password reset leaves `mustChangePassword` as it is
  (only the account's own `PATCH /auth/password` clears it): an account still forced to change its password stays
  forced (it signs in with the admin-set password, then chooses its own), and a resend no longer repeats the default
  password.
  Nobody can deactivate themselves or change their own role (409 `SELF_MODIFICATION`); see Roles and permissions for
  `PERMISSION_ESCALATION` and `ACCESS_LOCKOUT`. Duplicate email → 409 `EMAIL_TAKEN`.

### Public endpoints (no login)
- `GET /public/company` → `CompanyProfile` (always available; no rate limit — every page reads it) ·
  `GET /public/company/logo` → the logo bytes with its `Content-Type`, `X-Content-Type-Options: nosniff`,
  `Cross-Origin-Resource-Policy: cross-origin` and `Cache-Control: public, max-age=31536000, immutable` when the URL has
  `?v=` (else `no-cache`); 404 `NOT_FOUND` when there is no logo.
- `GET /public/libraries` → `{ data: PublicLibrarySummary[] }` — only libraries whose public form is enabled, sorted by
  name (the catalog's starting point).

The library endpoints below only work while `library.publicFormEnabled`; unknown slug and disabled form both return
the same 404 `NOT_FOUND`.
- `GET /public/libraries/:slug` → `{ library: { name, slug, description, location, defaultLoanDays }, categories: [{id,name}] }` (categories sorted by name)
- `GET /public/libraries/:slug/books?q&categoryId&available&page&pageSize` → paginated (pageSize default 20, max 50, sorted by title) non-archived books:
  `{ id, title, author, callNumber, category: {id,name} | null, available: boolean, coverUrl: string | null }`
  (`available` = `availableCopies > 0`; no exact counts. `available=true` → only books with a copy available now,
  `available=false` → only the others. `coverUrl` = `/api/public/libraries/<slug>/books/<id>/cover?v=<cover updatedAt ms>`
  when the book has a picture, else null.)
- `GET /public/libraries/:slug/books/:bookId/cover` → the picture bytes (same headers and caching rules as the logo);
  404 `NOT_FOUND` unless the book belongs to that (enabled) library, is not archived and has a picture.
- `POST /public/libraries/:slug/requests` `{ borrower: { name (2–120), email (required), idNumber? (≤50), contact? (≤120), affiliation? (≤120) }, items: [{bookId, quantity 1..5}] (1–20 distinct books, all from that library, non-archived — else 400 `INVALID_BOOKS`), notes? (≤500), website? }`
  → 201 `{ loanNumber: "BR-000123", status: "PENDING" }` (shown to the borrower as their request number). Creates a PENDING loan with `source = PUBLIC_FORM`, `submittedName = borrower.name`.
  `email`: trimmed, lower-cased, ≤ 254, and stricter than staff forms: `name@host.tld` (a dot in the domain, a
  top-level domain of 2+ letters) — the accept/reject email goes there.
  Borrower (inside the transaction, race-safe: row locks, inserts with ON CONFLICT DO NOTHING, and one retry of the
  whole request when a concurrent request claims the same email):
  1. a borrower with that email exists → link to it (their stored details are not overwritten);
  2. else, `idNumber` given and a borrower has it: their email is empty → it is set to this one (conditional update
     `WHERE email IS NULL`) and linked; a different email → 409 `EMAIL_MISMATCH` "This ID number is registered with a
     different email address. Please use that email or ask the library staff.";
  3. else a new borrower with that email.
  Books currently unavailable may still be requested (see Stock rules).
  Rate-limited per IP: 10 **failed** submissions (any 4xx) / 15 min and 60 submissions in total / 15 min — successful
  requests count only toward the larger limit, because borrowers at one school or parish (and everyone behind a
  proxy that does not forward client IPs) share one IP. Honeypot field `website`: absent or empty; non-empty → 400 `VALIDATION_ERROR`
  (the frontend renders it as a visually hidden input and never fills it).
- `GET /public/requests/:loanNumber?slug=` → `{ loanNumber, status, requestedAt, dueDate: DateOnly | null }` — lets a borrower
  check their request status (no personal data, no staff notes). `:loanNumber` takes any accepted reference-number
  form (`BR-000123`, `LN-000123`, `123`). `slug` is required; 404 if the loan doesn't exist, belongs
  to another library, or that library's form is disabled. Rate-limited: 30 / 15 min / IP.

### My Books (login + my_books.view)
- `GET /me/loans` → `MyLoansResponse` `{ borrower: Ref | null, data: PortalLoan[] }` — every borrow record of the
  borrower linked to the signed-in account (`User.borrowerId`; all statuses, all libraries), newest first. Not linked
  → `{ borrower: null, data: [] }`. Never another borrower's data, staff names or internal notes.
- `POST /me/requests` `{ slug, items: [{bookId, quantity 1..5}] (1–20 distinct), notes? (≤500) }` → 201
  `{ loanNumber, status: "PENDING", email: string | null }` — "Borrow more books" while signed in: a request for the
  linked borrower with no details form (same item rules and errors as the public request; the library's public form
  must be on, else 404). Stored like a public request (`source = PUBLIC_FORM`, `submittedName` = borrower name), so
  staff accept/reject it the same way and the decision email goes to the borrower's email (returned as `email`).
  Not linked → 409 `NOT_LINKED`. The borrower's stored details are never changed. Rate-limited: 60 / 15 min / IP.
- There is no separate borrower portal any more: `/portal/*` and `POST /borrowers/:id/reset-password` were removed;
  borrowers change their password with `PATCH /auth/password` like everyone else.

### Security
- helmet; JSON body limit 100kb (except `POST /books/bulk`: 1mb, since 500 rows do not fit in 100kb,
  `PUT /books/:id/cover`: 2mb, since a 1 MB picture is ~1.4 MB as base64, and `PUT /company/logo`: 1mb, since 512 KB is
  ~700 KB as base64; larger → 413 `PAYLOAD_TOO_LARGE`); CORS only for `CORS_ORIGIN`, with credentials.
- State-changing requests (POST/PUT/PATCH/DELETE) must send `Content-Type: application/json`, else 415
  `UNSUPPORTED_MEDIA_TYPE` (CSRF mitigation together with SameSite=Lax). The frontend wrapper always sends that
  header, with body `{}` when there is nothing to send (logout, cancel, delete).
- Passwords: bcryptjs, cost 10. JWT secret required in production (fail fast); dev default allowed with a console warning.
- Never return `passwordHash`. Public endpoints never return borrower data; `GET /me/loans` only returns the records of
  the borrower linked to the signed-in account. What an account (staff or borrower) can do is decided only by its
  role's permissions.
- Emails: every value interpolated into the HTML body is HTML-escaped; the company name (used in the subject) is a
  single line.

### Env (`backend/.env.example`)
`DATABASE_URL=postgresql://postgres:postgres@localhost:5432/lms?schema=public, PORT=3000, CORS_ORIGIN=http://localhost:5174,
JWT_SECRET, APP_TIMEZONE=Asia/Manila`
(frontend, optional: `API_PROXY_TARGET=http://localhost:3000`)
Optional backend `TRUST_PROXY` (Express "trust proxy", e.g. `1` or `loopback`): set it only when every request comes
through a proxy that sets `X-Forwarded-For` (e.g. nginx, or the Vite proxy with `xfwd: true`), so rate limits see real
client IPs. Without such a proxy leave it unset, otherwise clients could spoof their IP to dodge the limits.
Optional, for borrowers' accounts and emails:
- `APP_PUBLIC_URL` (default `http://localhost:5174`) — the web app's address, used for the sign-in link in emails.
- `BORROWER_DEFAULT_PASSWORD` (default `password123`; 8 characters – 72 bytes) — the first password of the account
  created when a borrower's request is accepted, written in the acceptance email.
- `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_SECURE` (`true`/`false`, default false), `SMTP_USER`, `SMTP_PASS`,
  `MAIL_FROM` (default: the company name at `SMTP_USER`, or at `no-reply@localhost`). Without `SMTP_HOST` no email leaves the machine (see
  "Decision emails and accounts").

### Seed
`npm run db:seed` → ensures the admin account **`admin@localhost`** with the password `SEED_ADMIN_PASSWORD` from `backend/.env` (default `password123`)
can always manage accounts, roles and permissions: the **Administrator** role is created with every permission if
missing, or gets every `users.*` and `roles.*` permission and `company.update` added back (nothing it has is removed); the **Staff** role is
created with its defaults if missing (never changed otherwise); if no role is the default role for new accounts, Staff
becomes it (an existing default is never changed, Administrator is never made the default); the account is created, or
its password is reset, it is re-activated and given the Administrator role (bumping `tokenVersion`). The Company
Profile row is created (default name "Library System") if missing; an existing one is never changed.
Idempotent, so it is the way to get a known login on any new PC. No demo data.
Emails are validated only as `name@host` (so local addresses like `admin@localhost` are accepted).

### Database
The default is an installed PostgreSQL on `localhost:5432` (`postgres` / `postgres`); `npm run db:migrate` creates
the `lms` database. For PCs without PostgreSQL, `npm run db:local` in `backend/` runs a real
local PostgreSQL **without a system-wide install** (e.g. the `embedded-postgres` npm package), listening on
`localhost:5432`, user `postgres` / password `postgres`, data directory `backend/.pgdata/` (gitignored),
creating database `lms` if missing, and stopping cleanly on Ctrl+C.
If port 5432 is already taken (e.g. by a system PostgreSQL service) it refuses to start and never stops the other
process; run it on another port with `DB_LOCAL_PORT=5433 npm run db:local` and point `DATABASE_URL` at that port.
`npm run db:stop` stops it cleanly from another terminal.

---

## Frontend

UI language: English, following **Terminology** (no "loan"/"lending" anywhere users can read). The app name and logo
in the sidebar, `<title>`, login and public pages come from the Company Profile (`GET /public/company`, cached
5 minutes; a book-icon tile stands in for a missing logo); `index.html` keeps "Library System" only as the title shown
before it loads. Responsive (usable on a phone at the counter).
Appearance (per browser, saved in localStorage `lms-theme`): Light / Dark / Automatic (follows the system; the default) and a main color — 8 presets (Gray default, Blue, Green, Teal, Purple, Pink, Indigo, Orange — no Red, so the main button never looks like a delete/overdue warning) or "Your own" via a color picker. Set from the profile dropdown at the right of the top bar (Light/Dark/Automatic inline; "Change colors…" opens Profile settings at `/account#colors`) and the Profile settings page "Light or dark, and colors" card. Accent colors are derived from the picked hue/chroma at fixed lightness so button text stays readable; applies to public pages too. `index.html` applies it before first paint.

### Routes
| Path | Access | Purpose |
|---|---|---|
| `/login` | public | Sign-in for every account (split layout on wide screens: brand panel with logo, name, tagline, a **Browse available books** button → `/catalog` and a "Check a request" link; sign-in card with show/hide password and a Caps Lock hint; a hint that people whose request was accepted sign in here with their email and the password from the acceptance email). After sign-in → `next` or `/` |
| `/catalog` | public | Libraries with a public form (`GET /public/libraries`); exactly one → straight to `/borrow/<slug>`; none → a friendly empty state with a link back to sign in |
| `/borrow/:slug` | public | Catalog and borrow form of a library (only if enabled; otherwise a friendly "not available" page): book grid with pictures, availability, search, grouping filter and "Available only" (on by default); chosen books go into a request with **Email (required)**, name, ID number, contact, affiliation, notes. The success screen adds "We'll email <email> when the library accepts or declines your request." |
| `/my-books` | my_books.view | **My Books** (inside the normal app layout): current borrows (due date, overdue), pending requests, history with the reason of a declined request (`GET /me/loans`); "Borrow more books" → `/catalog`. Account not linked to a borrower → "This account isn't linked to a borrower." |
| `/company-profile` | company.update | **Company Profile**: name, tagline, address, contact email and phone, and the logo (preview, replace, remove; shrunk in the browser before upload) |
| `/borrow/:slug/status` | public | Check request status by request number (`?loan=BR-000123` prefills and auto-checks; the parameter name is internal, any accepted form works) |
| `/` | dashboard.view (without it: the My Books page with my_books.view, else a short welcome page listing the pages the user can open) | Dashboard (`GET /dashboard`): stat cards (Pending requests, **Currently borrowed** = `loans.active`, Overdue, Returned this month, copies out), overdue list, pending requests, recent activity ("requested" / "borrowed" / "returned" / …) |
| `/borrow-records` | loans.view | **Borrow Records**. Tabs → query: Pending `status=PENDING` · Borrowed `status=BORROWED,PARTIALLY_RETURNED` · Overdue `overdue=true` · Returned `status=RETURNED` · All (no filter; includes Rejected/Cancelled); search (`q`: borrower, ID number or reference number); library from the switcher. Tab and search are kept in the URL query string |
| `/borrow-records/new` | loans.create | **Borrow Books**: staff borrow form, submit button **Confirm Borrow** |
| `/borrow-records/:id` | loans.view | Borrow details: reference number, borrower (with email), items, status timeline (built from `requestedAt`, `borrowedAt`+`approvedBy`, each return record, `closedAt`+`closedBy`); actions Edit items / Accept / Reject / Cancel (pending; the dialogs say "An email will be sent to <email>."), Extend due date (borrowed), **Return check** (borrowed). For PUBLIC_FORM records, show `submittedName` and warn when it differs from `borrower.name` so staff verify identity before approving, and the email state (`notification`: sent at / failed with the error / no email) with **Resend email** (loans.approve) |
| `/loans`, `/loans/*` | — | Legacy URLs from before the rename: redirect to the matching `/borrow-records` page |
| `/books` | books.view | Book list with search, library & category filters, availability; first column **Picture** (small cover, or a plain book icon when there is none); Add/Edit dialog; **Add many books** button; Archive |
| `/books/add-many` | books.create | **Add many books** page (see Key forms) |
| `/books/:id` | books.view | Book detail: the picture (larger), copies, who currently has it (`currentLoans`), **Borrowing history** (`GET /loans?bookId=`) |
| `/borrowers` | borrowers.view | Borrower list + search; `/borrowers/:id` shows **Current borrows** (what they still have) and the full **Borrowing history**, the email and "Online account": the linked account (email, role, active / must change password) with a link to Users for users.view holders, or "None — created when one of their requests is accepted." The borrower dialog has an email field |
| `/libraries` | libraries.view (actions need their own permission) | Libraries list; `/libraries/:id` → details (incl. **Default borrowing period (days)** = `defaultLoanDays`), groupings (categories) management, public form toggle + copyable public link (`window.location.origin + "/borrow/" + slug`) |
| `/users` | users.view or roles.view | Tabs **Accounts** (users.view: every account, staff and borrowers alike; an account linked to a borrower shows "Borrower: <name>" linking to `/borrowers/:id`, and a "Must change password" badge while `mustChangePassword`) and **Roles & permissions** (roles.view: role list + editor with the permission tree, Tree / List view) |
| `/account` | any signed-in user | Profile settings: own profile (role name and "Your permissions"), light/dark and colors, change password. `/account?change-password=1` (forced change): an alert "Change the default password before you continue" above the change-password card, which gets the focus |

### Layout
shadcn sidebar layout for staff pages: brand = company logo + name, nav (Dashboard, My Books, Borrow Records [badge: pending count =
`Dashboard.loans.pending` for the current switcher scope], Books, Borrowers, Libraries, Users, Company Profile — each item shown only with its permission), a **library
switcher** at the top (All libraries / one library; remembered in localStorage key `lms.libraryId`, falling back to
All if that library no longer exists) that scopes dashboard, Borrow Records and books by sending `libraryId` (omitted
for All). The top bar (right side) has a profile dropdown: name/email, Profile settings, Light/Dark/Automatic, Change colors…, Log out. Forms that need one library (add book, Add many books, Borrow Books) preselect the switcher's
library and otherwise require choosing one.
Unauthenticated access to staff routes redirects to `/login?next=…`; any `401 UNAUTHENTICATED` from the API
clears the cached user and does the same. After login, go to `next` (only if it is a relative path) or `/`. There is one
app for everyone (no separate borrower portal). While the signed-in user's `mustChangePassword` is set, every page
except `/account` redirects to `/account?change-password=1`; after the change the flag clears and the app works
normally. The Pending tab of Borrow Records has quick **Accept** / **Reject**
buttons per row (loans.approve; Reject asks for the reason).

### Key forms
- **Add / Edit book dialog** (same large, plain controls as **Add many books**, shared from
  `features/books/big-controls.ts` and `copies-stepper.tsx`): **Which library?** (add only; preselected from the
  switcher, or the only library when there is one), **Which category?** (+ New category… with a name box; on edit
  the book's own category shows by name even before the list loads), **Title**, **Author (optional)**, **Copies**
  (− / + stepper; add: 1–999 like Add many books; edit: 0 up to 999, or the book's current number if higher; "N
  borrowed now." under it), and **Picture (optional)** (add and edit): a preview (or a book icon) with big
  **Choose a picture** (file box `accept="image/*"`, so phones also offer the camera; the button says **Change
  picture** when there is one) and **Remove picture** buttons. The browser shrinks the picture to at most 800 px on
  its longest side and turns it into a JPEG (about 0.85 quality) before upload; a file that is not a picture shows
  "This file is not a picture. Please choose a photo." under the box (a HEIC/AVIF/TIFF/BMP photo the browser cannot
  open: "This photo cannot be opened here. Please choose a JPG or PNG picture."; both are read out by screen
  readers). A new, changed or removed picture counts as typed work for the close guard (when only the picture
  changed it says "The picture change will be lost." with [Go back] instead of [Keep typing]). On Save the book is saved first, then the picture (`PUT`/`DELETE
  /books/:id/cover`); if only the picture fails, the book stays saved and a toast says "The book was saved, but the
  picture was not. Open Edit to try again." Add shows only these and says the other details can be added later with Edit; Edit
  has a **More details (optional)** button (open from the start when the book already has any) with Shelf
  number (`callNumber`), ISBN, Publisher, Year published, Notes — a problem in one of those opens it (and it stays
  open). Errors in plain words under the box; after Save (also for errors from the server, once saving ends) focus
  goes to the first box with a problem, top to bottom. **Cancel** button beside **Add book** / **Save changes**; closing (Cancel, ✕, Esc, a
  click outside) after typing asks "Close without saving? What you typed will be lost." [Keep typing] [Close
  without saving].
- **Borrow form (staff and public share one component)**: borrower section (staff: search existing borrower
  or enter new, email optional; public: **email (required)**, name, ID number, contact, affiliation), book picker (search within the library,
  shows availability, add multiple books, quantity per book, remove line), due date (staff only), notes.
  Staff picker uses `GET /books?libraryId&q` and shows `availableCopies` (quantity capped at it client-side;
  server is authoritative); public picker uses the public books endpoint, shows Available / Currently out
  (out books may still be requested, with a note that staff will confirm), quantity 1–5, max 20 books.
  Client-side validation mirrors the API. On 409 `INSUFFICIENT_COPIES` / 400 `INVALID_BOOKS` the affected
  lines are highlighted from `details`. Staff success: toast "Books borrowed (BR-000123)" and go to the new borrow
  record. Public success screen shows the request number (`BR-000123`), tells the borrower to present it to the
  staff, links to `/borrow/:slug/status`, and says the borrower will be emailed when the library accepts or declines
  the request (409 `EMAIL_MISMATCH` is shown on the email field).
- **Return check** (on borrow details, currently borrowed records only): a checklist table of every borrowed item with *Borrowed /
  Already returned / Outstanding* and inputs *Good / Damaged / Lost*, all **defaulting to 0** so staff actually
  count what was handed back; a per-row "All good" button and an "All returned in good condition" button fill
  Good = outstanding. Optional "Returned by (if not the borrower)" and notes fields. Shows a live summary and
  highlights mismatches (e.g. "2 of 3 copies returned — 1 still outstanding"); inputs cannot exceed outstanding.
  Confirm dialog before submitting. Supports partial returns; history of past return checks (who checked, who
  returned, when, counts) is listed below.
- **Add many books** (`/books/add-many`, designed for older staff): large text (17–18px inputs and labels),
  controls at least 44px tall, plain words, no technical terms. Step 1, once for the whole page: **Which library?**
  (preselected from the switcher, then kept: a later switcher change does not move it) and **Which category?** (the
  library's categories, "No category", or "+ New category…" with a name box → `categoryName`; an existing one →
  `categoryId`; the box is disabled while they load; "Could not load the
  categories. [Try again]" on error). Step 2 **Type the books**: rows of Title
  (required), Author (optional), Copies (1–999, big − / + buttons and arrow keys, default 1; a typed number above
  999 becomes 999 with a note) and a red **Remove** button set apart from the + button; a removed row that had
  text is replaced in place by "“Title” was removed. [Bring it back]" (no toast); starts with 5 rows, **+ Add another book** adds one, Enter in Title/Author moves to the next row's Title (adding a row at the
  end). Completely empty rows are ignored; a row with no title shows "Please type the book title." — errors appear
  only after the first Save, and the save bar's message is worked out from the current rows (it goes away once
  fixed). Pasting several lines into a Title box fills that row and the following empty ones (column 1 title,
  2 author, 3 copies if a number; a first line of column names such as "Title" / "Pamagat ng Aklat" / "May-akda"
  is skipped and says where each column is; without one, a first column that only numbers the lines is dropped).
  A plain list pasted into an Author box fills the authors of that row and the rows below. A sticky bar shows
  "4 books ready to save — 7 copies in total" and **Save 4 books** (disabled, with the reason, when there is no
  library or no book, or more than 500). Submits to `/books/bulk` (server errors mapped back to rows via
  `details.issues[].path` `["books", rowIndex, field]`, shown in plain words under the row and linked to the right
  box, which gets focus); a quick double-click sends one request; success shows "4 books were added to <Library>
  (<Category>)." with **Add more books** (keeps library and category) and **Go to Books** (switches the sidebar to
  that library when it shows another one). Leaving with typed books asks "Leave without saving? The books you
  typed will be lost."; leaving while saving shows "Please wait" until the save ends. Other details (ISBN, call number, …)
  are added later by editing a book. At phone width each row stacks (Title, Author, then Copies + Remove).

### Data layer
`src/lib/api.ts` typed fetch wrapper (`credentials: 'include'`, JSON, throws `ApiError {status, code, message, details}`),
`src/types/api.ts` types copied from **Response shapes**, react-query hooks per resource, toasts on success/error
(using `error.message`), form errors mapped from `VALIDATION_ERROR` `details.issues` where possible. A 204 response
resolves to `undefined`. Dates are shown in `Asia/Manila` local format; `dueDate` strings are displayed as-is
(never parsed through `new Date()`, which would shift the day).
