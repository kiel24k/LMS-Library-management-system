# LMS Frontend — Library System

React 19 + TypeScript + Vite 8, Tailwind CSS v4 and shadcn/ui (style `base-nova`, built on `@base-ui/react`).
Implements the **Frontend** section of [`../docs/SPEC.md`](../docs/SPEC.md). For first-time setup of the whole system
and the staff's daily workflow, see the [project README](../README.md).

## Setup

```bash
npm install
npm run dev
```

The dev server runs at http://localhost:5174. Requests to `/api/*` are proxied to the backend
(`http://localhost:3000` by default). Start the backend (and `npm run db:local` in `backend/`) first.

To point the proxy somewhere else, set `API_PROXY_TARGET`, either in `frontend/.env` (copy `.env.example`; git-ignored)
or as a shell variable, which wins over the file (e.g. when running tests on other ports):

```bash
# PowerShell
$env:API_PROXY_TARGET = "http://localhost:3100"; npx vite --port 5180 --strictPort
# bash
API_PROXY_TARGET=http://localhost:3100 npx vite --port 5180 --strictPort
```

## Scripts

| Script            | Description                              |
| ----------------- | ---------------------------------------- |
| `npm run dev`     | Start the Vite dev server                |
| `npm run build`   | Type-check (`tsc -b`) and build for production |
| `npm run preview` | Preview the production build (same `/api` proxy) |
| `npm run lint`    | Lint the project with oxlint             |

## Pages

| Path | Access | What it does |
|---|---|---|
| `/login` | public | Staff sign-in; returns to `?next=` (relative paths only) |
| `/borrow/:slug` | public | Public borrow form (friendly "not available" page when the form is off / unknown) → success screen with the request number (`BR-000123`) |
| `/borrow/:slug/status` | public | Check a request by request number (`?ref=BR-000123` pre-fills and checks; the old `?loan=` parameter from earlier links still works) |
| `/` | staff | Dashboard: stat cards (incl. **Currently borrowed**), overdue list, pending requests, recent activity |
| `/borrow-records` | staff | **Borrow Records**: tabs Pending / Borrowed / Overdue / Returned / All, search (borrower, ID number or reference number), pagination (tab, `q`, page in the URL) |
| `/borrow-records/new` | staff | **Borrow Books**: staff borrow form, submitted with **Confirm Borrow** (creates a BORROWED record right away) |
| `/borrow-records/:id` | staff | Borrow details: items, timeline, approve / edit items / reject / cancel (pending), extend due date (borrowed), **return check**, return history, identity warning for public requests |
| `/loans`, `/loans/*` | — | Old links (bookmarks from before the rename) redirect to the matching `/borrow-records` page |
| `/books`, `/books/:id` | staff | Catalog with search, category & availability filters, add/edit dialog, archive/restore/delete; detail shows who has it and its **Borrowing history** |
| `/books/add-many` | staff | **Add many books**: large-print page for older staff — library and section chosen once, then one row per book (title, author, copies with − / +); Enter moves to the next row; Remove can be undone in place ("Bring it back"); a list pasted from Excel into a Title box fills the rows (header line and numbering column skipped); the page keeps its own library once chosen; saves through `POST /books/bulk`, and **Go to Books** switches the sidebar to the saved library |
| `/borrowers`, `/borrowers/:id` | staff | Borrowers list/search, detail with what they still have and full history |
| `/libraries`, `/libraries/:id` | staff (edit: admin) | Libraries, details, groupings (categories), public form toggle + copyable link |
| `/users` | admin | Staff accounts (create, edit role/active, reset password) |
| `/account` | staff | Change own password |

The sidebar's **library switcher** (remembered in `localStorage` key `lms.libraryId`) scopes the dashboard,
Borrow Records and books; the Borrow Records item shows the pending-request count for the current scope.

**Wording rule:** the UI never says "loan", "lend" or "lending" (it sounds like borrowing money). Use *borrow
record*, *Borrow Records*, *Borrow Books*, *Confirm Borrow*, *reference number* (staff) / *request number*
(public), *Currently borrowed*, *borrowing period* and *Borrowing history*; the app name is **Library System**.
Code, API paths and JSON fields keep their `loan` names (`/api/loans`, `loanNumber`, `defaultLoanDays`, …).
See the Terminology section of the spec.

## Code layout

```
src/
  main.tsx, router.tsx        app entry, routes (lazy-loaded pages), system light/dark
  types/api.ts                API types copied from the spec ("Response shapes") + request bodies
  lib/api.ts                  fetch wrapper: credentials include, JSON, ApiError {status, code, message, details}
  lib/query-client.ts         react-query client (no retry on 4xx, global mutation error toasts)
  lib/format.ts               BR-000123 reference numbers, Asia/Manila dates, due dates shown as-is (never via new Date())
  lib/library-scope.ts        library switcher context
  features/<resource>/        react-query hooks (api.ts) and feature components
    loans/borrow-form.tsx     shared Borrow form (staff + public modes)
    loans/loan-items-editor   book picker + quantity lines (also used by "Edit items")
    loans/return-check.tsx    return checklist with live mismatch summary and confirm dialog
    books/paste-books.ts      turns a list pasted into a Title box (Excel columns: title, author, copies) into rows
  components/                 layout (sidebar), auth guards, shared states, badges, dialogs
  components/ui/              shadcn components (base-ui: use the `render` prop, not `asChild`)
  pages/                      one file per route
```

## Notes

- Any `401 UNAUTHENTICATED` from the API clears the cached user and sends staff to `/login?next=…`.
- Every POST/PATCH/DELETE sends `Content-Type: application/json` (body `{}` when empty), as the API requires.
- Validation errors from the API (`VALIDATION_ERROR` `details.issues`) are mapped onto form fields where possible;
  `INSUFFICIENT_COPIES` / `INVALID_BOOKS` highlight the affected book lines; save errors on the Add many books page map back to the right row.

## Adding shadcn/ui components

```bash
npx shadcn@latest add <component> --yes
```

Components are placed in `src/components/ui`. Import with the `@/` alias, e.g. `import { Button } from "@/components/ui/button"`.
