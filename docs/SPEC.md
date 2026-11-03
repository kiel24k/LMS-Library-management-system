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
| App name | **Library System** |
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

Non-goals (for now): fines/payments, barcode scanning, email/SMS notifications,
per-copy accession tracking (copies are counted, not individually identified),
per-library staff permissions.

---

## Tech

- `backend/`: Node 22, Express 5, TypeScript (ESM, `nodenext`), Prisma 7 (`prisma-client`
  generator → `src/generated/prisma`, `@prisma/adapter-pg`), PostgreSQL, zod validation,
  bcryptjs, jsonwebtoken, cookie-parser, helmet, express-rate-limit. Tests: vitest + supertest.
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
enum Role        { ADMIN STAFF }
enum LoanStatus  { PENDING BORROWED PARTIALLY_RETURNED RETURNED REJECTED CANCELLED }
enum LoanSource  { STAFF PUBLIC_FORM }

model User {
  id           String   @id @default(cuid())
  email        String   @unique          // stored lower-cased
  name         String
  passwordHash String
  role         Role     @default(STAFF)
  active       Boolean  @default(true)
  tokenVersion Int      @default(0)      // copied into each JWT; bumped to sign the user out everywhere (see Auth)
  // relations: loansCreated, loansApproved, returnsReceived
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
  id          String  @id @default(cuid())
  name        String
  idNumber    String? @unique              // student/employee/parishioner ID, optional
  contact     String?                      // phone or email
  affiliation String?                      // e.g. "Grade 10 - St. Luke", "Faculty", "Parish youth"
  // relations: loans
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
```

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
- Approve: `borrowedAt = now`, `approvedById = current user`, `dueDate` = given or default.
- Reject / cancel: `closedAt = now`, `closedById = current user`, `staffNotes = reason` (if given).
- Final return (→ RETURNED): `closedAt = now`, `closedById = current user`.

### Delete rules
- Library: delete only if it has no books (archived included) and no loans (else 409 `LIBRARY_NOT_EMPTY`). Its categories are deleted with it.
- Category: delete allowed; its books get `categoryId = null`.
- Book: delete only if it never appeared in a loan; otherwise 409 `BOOK_HAS_LOANS` → archive instead.
- Borrower: delete only if no loans (else 409 `BORROWER_HAS_LOANS`).
- Users are never deleted, only deactivated.
- Loans are never deleted.

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

type User = { id: string; email: string; name: string; role: "ADMIN" | "STAFF"; active: boolean; createdAt: ISODateTime };

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
  createdAt: ISODateTime; updatedAt: ISODateTime;
  activeLoans: number;        // open loans
  outstandingCopies: number;  // sum of outstanding over open loans
};
type BorrowerDetail = Borrower & { loans: Loan[] };   // all loans, newest first

type LoanItem = {
  id: string; bookId: string;
  book: { id: string; title: string; author: string | null; callNumber: string | null; archived: boolean };
  quantity: number; returnedGood: number; returnedDamaged: number; lost: number; outstanding: number;
};

type Loan = {                 // list item (GET /loans, dashboard, borrower detail)
  id: string; number: number; loanNumber: string;   // 123, "BR-000123"
  libraryId: string; library: Ref;
  borrower: { id: string; name: string; idNumber: string | null; contact: string | null; affiliation: string | null };
  source: "STAFF" | "PUBLIC_FORM"; status: LoanStatus;
  requestedAt: ISODateTime; borrowedAt: ISODateTime | null; dueDate: DateOnly | null; closedAt: ISODateTime | null;
  notes: string | null; staffNotes: string | null; submittedName: string | null;
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

### Error codes

| Status | `code` | When / `details` |
|---|---|---|
| 400 | `VALIDATION_ERROR` | body/query fails zod; `details: { issues: [{ path: (string\|number)[], message: string }] }` (e.g. path `["books", 3, "title"]` in bulk, `["items", 0, "quantity"]`) |
| 400 | `INVALID_BOOKS` | a book doesn't exist, is in another library, or is archived; `details: { bookIds: string[] }` |
| 400 | `INVALID_CATEGORY` | category doesn't belong to the book's library |
| 400 | `RETURN_EXCEEDS_OUTSTANDING` | `details: { loanItemIds: string[] }` |
| 400 | `WRONG_PASSWORD` | `PATCH /auth/password` with wrong `currentPassword` |
| 400 | `INVALID_IMAGE` | `PUT /books/:id/cover`: not a `data:image/jpeg\|png\|webp;base64,…` URL, bad base64, or first bytes that do not match the stated type |
| 401 | `INVALID_CREDENTIALS` | login with wrong email/password or inactive user (same message for both) |
| 401 | `UNAUTHENTICATED` | missing/invalid/expired token, or user deactivated |
| 403 | `FORBIDDEN` | STAFF calling an ADMIN endpoint |
| 404 | `NOT_FOUND` | unknown id/slug/route, or public form disabled |
| 409 | `INSUFFICIENT_COPIES` | `details: { books: [{ bookId, title, requested, available }] }` |
| 409 | `INVALID_STATUS` | action not allowed in the loan's current status; `details: { status }` |
| 409 | `SLUG_TAKEN` · `CATEGORY_EXISTS` · `EMAIL_TAKEN` · `ID_NUMBER_TAKEN` | uniqueness (category names unique per library, case-insensitive) |
| 409 | `LIBRARY_NOT_EMPTY` · `BOOK_HAS_LOANS` · `BORROWER_HAS_LOANS` | delete rules |
| 409 | `COPIES_IN_USE` | `totalCopies` edit would make `availableCopies` < 0 |
| 409 | `LAST_ADMIN` · `SELF_MODIFICATION` | user rules |
| 409 | `CONFLICT` | safety net: the data changed underneath the request in a way no specific code covers (e.g. a rare concurrent write conflict); retrying usually succeeds. Known races (e.g. a book, borrower, library or grouping deleted while a loan or book is being created) return their specific code instead (`INVALID_BOOKS`, `NOT_FOUND`, `INVALID_CATEGORY`, `CATEGORY_EXISTS`, …) |
| 413 | `PAYLOAD_TOO_LARGE` | request body over the size limit (see Security) |
| 413 | `IMAGE_TOO_LARGE` | `PUT /books/:id/cover`: the decoded picture is over 1 MB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | state-changing request without `Content-Type: application/json` |
| 429 | `RATE_LIMITED` | rate limit hit |
| 500 | `INTERNAL_ERROR` | unexpected error (no stack traces in the body) |

### Auth (cookie `lms_token`, httpOnly, SameSite=Lax, Secure in production, JWT 7d, `JWT_SECRET` env)
- `POST /auth/login` `{email, password}` → 200 `{ user }` + sets cookie (rate-limited: 10 **failed** attempts / 15 min / IP; successful logins are not counted, because staff at one site usually share a public IP). Wrong credentials or inactive user → 401 `INVALID_CREDENTIALS`.
- `POST /auth/logout` → 204, clears cookie (also 204 when not logged in). It also ends the session server-side:
  the token (and any copy of it) stops working, and so do the user's sessions on other devices.
- `GET /auth/me` → `{ user }` or 401 `UNAUTHENTICATED`. On every authenticated request the user is re-loaded; deactivated users get 401.
- `PATCH /auth/password` `{currentPassword, newPassword}` (min 8 characters, max 72 **bytes** in UTF-8 — bcrypt ignores
  anything longer; plain ASCII = 72 characters, accented letters take 2 bytes, emoji 4) → 204 and a fresh cookie:
  the current session stays signed in, every other session of that user is signed out.
- Sessions: each JWT carries the user's `tokenVersion`, which must still match on every request (else 401
  `UNAUTHENTICATED`). It is bumped by logout, the user's own password change, an admin password reset and
  deactivation, so all earlier tokens of that user stop working immediately (not only after 7 days).
- `user` shape: `User` (see Response shapes; never the hash)

### Staff endpoints (require login; ADMIN-only where marked, everything else any active STAFF or ADMIN)
- **Libraries**: `GET /libraries` → `{ data: Library[] }` (all libraries, sorted by name) ·
  `POST /libraries` ADMIN · `GET /libraries/:id` → `Library` · `PATCH /libraries/:id` ADMIN · `DELETE /libraries/:id` ADMIN.
  `LibraryInput = { name (1–120), slug?, description? (≤1000), location? (≤200), publicFormEnabled? (default false), defaultLoanDays? (1–365, default 7) }`.
  Slug: lowercase `a-z0-9-`, 3–60 chars, unique (409 `SLUG_TAKEN`); if omitted on create it is generated from
  the name (padded/suffixed `-2`, `-3`… to be valid and unique). Changing the slug changes the public link.
- **Categories**: `GET /libraries/:libraryId/categories` → `{ data: Category[] }` (sorted by name) ·
  `POST /libraries/:libraryId/categories` `{ name (1–80), description? (≤500) }` → `Category` ·
  `PATCH /categories/:id` · `DELETE /categories/:id`. Name unique per library, case-insensitive (409 `CATEGORY_EXISTS`).
- **Books**: `GET /books?libraryId&categoryId&q&available=true&includeArchived=true&page&pageSize` → paginated `Book`
  (sorted by title; `q` matches title/author/isbn/callNumber, case-insensitive substring; `available=true` → `availableCopies > 0`;
  archived books excluded unless `includeArchived=true`) · `POST /books` `BookInput & { libraryId }` → `Book` ·
  `POST /books/bulk` `{ libraryId, books: BookInput[] }` (1–500 rows; all-or-nothing; category given by
  `categoryName`, matched case-insensitively within the library, created if missing) → 201 `{ created: number, categoriesCreated: string[] }` ·
  `GET /books/:id` → `BookDetail` ·
  `PATCH /books/:id` (any `BookInput` field plus `archived`; `libraryId` cannot change; `totalCopies` int 0–10000 per Stock rules) → `Book` ·
  `DELETE /books/:id` ·
  **Picture**: `PUT /books/:id/cover` `{ image: string }` (a `data:image/jpeg|png|webp;base64,…` URL; decoded at most
  1 MB, else 413 `IMAGE_TOO_LARGE`; another type, bad base64, or first bytes that do not match the stated type → 400
  `INVALID_IMAGE`) → `Book` (replaces any old picture) · `DELETE /books/:id/cover` → `Book` (no picture is fine) ·
  `GET /books/:id/cover` → the image bytes with its `Content-Type` and `Cache-Control: private, max-age=31536000,
  immutable` (404 `NOT_FOUND` when the book or its picture does not exist). Archived books keep their picture.
  Pictures are staff-only (not on public endpoints).
  `BookInput = { title (1–300), author? (≤200), isbn? (≤40), publisher? (≤200), publicationYear? (int 1000–9999), callNumber? (≤100), totalCopies (int 1–10000, default 1), categoryId? | categoryName?, notes? (≤1000) }`
  (send at most one of `categoryId` / `categoryName`; on single create/PATCH `categoryName` also matches-or-creates).
  A book's category must belong to the same library (400 `INVALID_CATEGORY`).
- **Borrowers**: `GET /borrowers?q&page&pageSize` → paginated `Borrower` (sorted by name; `q` matches name/idNumber/contact, case-insensitive) ·
  `POST /borrowers` `BorrowerInput` → `Borrower` · `GET /borrowers/:id` → `BorrowerDetail` ·
  `PATCH /borrowers/:id` · `DELETE /borrowers/:id`.
  `BorrowerInput = { name (2–120), idNumber? (≤50), contact? (≤120), affiliation? (≤120) }`; duplicate `idNumber` → 409 `ID_NUMBER_TAKEN`.
- **Loans** (`POST /loans` and every POST/PATCH on `/loans/:id` respond with the resulting `LoanDetail`):
  - `GET /loans?libraryId&status&borrowerId&bookId&overdue=true&q&page&pageSize` → paginated `Loan`.
    `status` accepts one value or a comma-separated list (e.g. `BORROWED,PARTIALLY_RETURNED`); `overdue=true` → only overdue loans;
    `bookId` → loans containing that book. `q` matches borrower name/idNumber (case-insensitive substring) or reference
    number (any accepted form: `BR-`, `LN-` or bare number). Sorted by `requestedAt` desc (newest first).
  - `POST /loans` (staff form) `{ libraryId, borrowerId | borrower: BorrowerInput, items: [{bookId, quantity}], dueDate?, notes? (≤500) }`
    → 201, creates a **BORROWED** loan (`source = STAFF`), deducts stock. Exactly one of `borrowerId` / `borrower`.
    If `borrower.idNumber` matches an existing borrower, that borrower is used (their details are not overwritten);
    otherwise a new borrower is created. Items: 1–50 distinct books (duplicate `bookId` → 400), quantity 1–100,
    all in `libraryId` and non-archived (else 400 `INVALID_BOOKS`). `dueDate` ≥ today, default per Derived values.
  - `GET /loans/:id` → `LoanDetail`.
  - `PATCH /loans/:id` `{ items?, notes?, dueDate? }`: `items` (full replacement list, same rules as `POST /loans`, except that a
    book already on the request that has since been archived may stay in the list — only newly added books must be non-archived;
    approval still rejects it until it is removed) only while PENDING; `dueDate` (≥ today; used to extend a loan) only while BORROWED or PARTIALLY_RETURNED; `notes` while not closed.
    Anything else → 409 `INVALID_STATUS`.
  - `POST /loans/:id/approve` `{ dueDate? }` — PENDING → BORROWED (stock check, 409 `INSUFFICIENT_COPIES`; archived
    books → 400 `INVALID_BOOKS`; staff can then reduce/remove items via PATCH and approve again). `dueDate` ≥ today,
    default per Derived values.
  - `POST /loans/:id/reject` `{ reason (1–500) }` — PENDING → REJECTED.
  - `POST /loans/:id/cancel` `{ reason? (≤500) }` — PENDING → CANCELLED (e.g. borrower withdrew / never came).
  - `POST /loans/:id/returns` `{ items: [{ loanItemId, good, damaged, lost }], returnedByName? (≤120), notes? (≤500) }` → 200 `LoanDetail` —
    only for BORROWED/PARTIALLY_RETURNED. Every `loanItemId` must belong to this loan and appear at most once (else 400
    `VALIDATION_ERROR`); items not listed count as 0. Each count is an int ≥ 0, at least one count > 0 overall, and per item
    `good+damaged+lost ≤ outstanding` (else 400 `RETURN_EXCEEDS_OUTSTANDING`). Creates a ReturnRecord (receivedBy = current user),
    updates LoanItems, stock, and loan status (PARTIALLY_RETURNED, or RETURNED + `closedAt`/`closedById` when nothing is outstanding).
- **Dashboard**: `GET /dashboard?libraryId` → `Dashboard` (all libraries when `libraryId` omitted).
- **Users** (ADMIN): `GET /users` → `{ data: User[] }` (sorted by name) · `POST /users` `{email, name (1–120), password (8 characters – 72 bytes, as for `PATCH /auth/password`), role}` → `User` ·
  `PATCH /users/:id` `{name?, role?, active?, password?}` → `User` (password = admin reset; email is immutable).
  A password reset or deactivation signs that user out everywhere (when admins reset their own password, their
  current session gets a fresh cookie and stays signed in).
  An admin cannot deactivate or demote themselves (409 `SELF_MODIFICATION`); there must always be at least one active
  ADMIN (409 `LAST_ADMIN`). Duplicate email → 409 `EMAIL_TAKEN`.

### Public endpoints (no login; only when `library.publicFormEnabled`, else 404)
Unknown slug and disabled form both return the same 404 `NOT_FOUND`.
- `GET /public/libraries/:slug` → `{ library: { name, slug, description, location, defaultLoanDays }, categories: [{id,name}] }` (categories sorted by name)
- `GET /public/libraries/:slug/books?q&categoryId&page&pageSize` → paginated (pageSize default 20, max 50, sorted by title) non-archived books:
  `{ id, title, author, callNumber, category: {id,name} | null, available: boolean }` (`available` = `availableCopies > 0`; no exact counts).
- `POST /public/libraries/:slug/requests` `{ borrower: { name (2–120), idNumber? (≤50), contact? (≤120), affiliation? (≤120) }, items: [{bookId, quantity 1..5}] (1–20 distinct books, all from that library, non-archived — else 400 `INVALID_BOOKS`), notes? (≤500), website? }`
  → 201 `{ loanNumber: "BR-000123", status: "PENDING" }` (shown to the borrower as their request number). Creates a PENDING loan with `source = PUBLIC_FORM`, `submittedName = borrower.name`.
  Borrower: if `idNumber` matches an existing borrower, link to it (do not overwrite their details); otherwise create one.
  Books currently unavailable may still be requested (see Stock rules).
  Rate-limited per IP: 10 **failed** submissions (any 4xx) / 15 min and 60 submissions in total / 15 min — successful
  requests count only toward the larger limit, because borrowers at one school or parish (and everyone behind a
  proxy that does not forward client IPs) share one IP. Honeypot field `website`: absent or empty; non-empty → 400 `VALIDATION_ERROR`
  (the frontend renders it as a visually hidden input and never fills it).
- `GET /public/requests/:loanNumber?slug=` → `{ loanNumber, status, requestedAt, dueDate: DateOnly | null }` — lets a borrower
  check their request status (no personal data, no staff notes). `:loanNumber` takes any accepted reference-number
  form (`BR-000123`, `LN-000123`, `123`). `slug` is required; 404 if the loan doesn't exist, belongs
  to another library, or that library's form is disabled. Rate-limited: 30 / 15 min / IP.

### Security
- helmet; JSON body limit 100kb (except `POST /books/bulk`: 1mb, since 500 rows do not fit in 100kb, and
  `PUT /books/:id/cover`: 2mb, since a 1 MB picture is ~1.4 MB as base64; larger → 413 `PAYLOAD_TOO_LARGE`); CORS only for `CORS_ORIGIN`, with credentials.
- State-changing requests (POST/PUT/PATCH/DELETE) must send `Content-Type: application/json`, else 415
  `UNSUPPORTED_MEDIA_TYPE` (CSRF mitigation together with SameSite=Lax). The frontend wrapper always sends that
  header, with body `{}` when there is nothing to send (logout, cancel, delete).
- Passwords: bcryptjs, cost 10. JWT secret required in production (fail fast); dev default allowed with a console warning.
- Never return `passwordHash`. Public endpoints never return borrower data.

### Env (`backend/.env.example`)
`DATABASE_URL=postgresql://postgres:postgres@localhost:5432/lms?schema=public, PORT=3000, CORS_ORIGIN=http://localhost:5174,
JWT_SECRET, APP_TIMEZONE=Asia/Manila`
(frontend, optional: `API_PROXY_TARGET=http://localhost:3000`)
Optional backend `TRUST_PROXY` (Express "trust proxy", e.g. `1` or `loopback`): set it only when every request comes
through a proxy that sets `X-Forwarded-For` (e.g. nginx, or the Vite proxy with `xfwd: true`), so rate limits see real
client IPs. Without such a proxy leave it unset, otherwise clients could spoof their IP to dodge the limits.

### Seed
`npm run db:seed` → ensures the admin account **`admin@localhost` / `password123`** (hard-coded in `prisma/seed.ts`):
creates it, or resets its password and makes it an active ADMIN again if it exists (bumping `tokenVersion`).
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

UI language: English, following **Terminology** (no "loan"/"lending" anywhere users can read; the app name in the
sidebar, `<title>`, login and public pages is "Library System"). Responsive (usable on a phone at the counter).
Appearance (per browser, saved in localStorage `lms-theme`): Light / Dark / Automatic (follows the system; the default) and a main color — 8 presets (Gray default, Blue, Green, Teal, Purple, Pink, Indigo, Orange — no Red, so the main button never looks like a delete/overdue warning) or "Your own" via a color picker. Set from the profile dropdown at the right of the top bar (Light/Dark/Automatic inline; "Change colors…" opens Profile settings at `/account#colors`) and the Profile settings page "Light or dark, and colors" card. Accent colors are derived from the picked hue/chroma at fixed lightness so button text stays readable; applies to public pages too. `index.html` applies it before first paint.

### Routes
| Path | Access | Purpose |
|---|---|---|
| `/login` | public | Staff login |
| `/borrow/:slug` | public | Public borrow form for a library (only if enabled; otherwise a friendly "not available" page) |
| `/borrow/:slug/status` | public | Check request status by request number (`?loan=BR-000123` prefills and auto-checks; the parameter name is internal, any accepted form works) |
| `/` | staff | Dashboard (`GET /dashboard`): stat cards (Pending requests, **Currently borrowed** = `loans.active`, Overdue, Returned this month, copies out), overdue list, pending requests, recent activity ("requested" / "borrowed" / "returned" / …) |
| `/borrow-records` | staff | **Borrow Records**. Tabs → query: Pending `status=PENDING` · Borrowed `status=BORROWED,PARTIALLY_RETURNED` · Overdue `overdue=true` · Returned `status=RETURNED` · All (no filter; includes Rejected/Cancelled); search (`q`: borrower, ID number or reference number); library from the switcher. Tab and search are kept in the URL query string |
| `/borrow-records/new` | staff | **Borrow Books**: staff borrow form, submit button **Confirm Borrow** |
| `/borrow-records/:id` | staff | Borrow details: reference number, borrower, items, status timeline (built from `requestedAt`, `borrowedAt`+`approvedBy`, each return record, `closedAt`+`closedBy`); actions Edit items / Approve / Reject / Cancel (pending), Extend due date (borrowed), **Return check** (borrowed). For PUBLIC_FORM records, show `submittedName` and warn when it differs from `borrower.name` so staff verify identity before approving |
| `/loans`, `/loans/*` | — | Legacy URLs from before the rename: redirect to the matching `/borrow-records` page |
| `/books` | staff | Book list with search, library & category filters, availability; first column **Picture** (small cover, or a plain book icon when there is none); Add/Edit dialog; **Add many books** button; Archive |
| `/books/add-many` | staff | **Add many books** page (see Key forms) |
| `/books/:id` | staff | Book detail: the picture (larger), copies, who currently has it (`currentLoans`), **Borrowing history** (`GET /loans?bookId=`) |
| `/borrowers` | staff | Borrower list + search; `/borrowers/:id` shows **Current borrows** (what they still have) and the full **Borrowing history** |
| `/libraries` | staff (edit: ADMIN) | Libraries list; `/libraries/:id` → details (incl. **Default borrowing period (days)** = `defaultLoanDays`), groupings (categories) management, public form toggle + copyable public link (`window.location.origin + "/borrow/" + slug`) |
| `/users` | ADMIN | Staff accounts |
| `/account` | staff | Profile settings: own profile, light/dark and colors, change password |

### Layout
shadcn sidebar layout for staff pages: brand "Library System", nav (Dashboard, Borrow Records [badge: pending count =
`Dashboard.loans.pending` for the current switcher scope], Books, Borrowers, Libraries, Users [admin]), a **library
switcher** at the top (All libraries / one library; remembered in localStorage key `lms.libraryId`, falling back to
All if that library no longer exists) that scopes dashboard, Borrow Records and books by sending `libraryId` (omitted
for All). The top bar (right side) has a profile dropdown: name/email, Profile settings, Light/Dark/Automatic, Change colors…, Log out. Forms that need one library (add book, Add many books, Borrow Books) preselect the switcher's
library and otherwise require choosing one.
Unauthenticated access to staff routes redirects to `/login?next=…`; any `401 UNAUTHENTICATED` from the API
clears the cached user and does the same. After login, go to `next` (only if it is a relative path) or `/`.

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
  or enter new; public: name, ID number, contact, affiliation), book picker (search within the library,
  shows availability, add multiple books, quantity per book, remove line), due date (staff only), notes.
  Staff picker uses `GET /books?libraryId&q` and shows `availableCopies` (quantity capped at it client-side;
  server is authoritative); public picker uses the public books endpoint, shows Available / Currently out
  (out books may still be requested, with a note that staff will confirm), quantity 1–5, max 20 books.
  Client-side validation mirrors the API. On 409 `INSUFFICIENT_COPIES` / 400 `INVALID_BOOKS` the affected
  lines are highlighted from `details`. Staff success: toast "Books borrowed (BR-000123)" and go to the new borrow
  record. Public success screen shows the request number (`BR-000123`), tells the borrower to present it to the
  staff, and links to `/borrow/:slug/status`.
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
