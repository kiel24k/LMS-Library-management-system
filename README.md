# Library System

A small web app for the library staff to **register books** and **track who borrowed what and who returned it**.

- **Books are registered per library, by category.** There can be several libraries; each has its own categories
  (such as *Filipiniana*, *Fiction*, *Reference*). Books can be added one at a time, or many at once on
  a simple **Add many books** page (type the titles, or paste a list from Excel / Google Sheets). Each book has a number of copies.
- **Borrow form.** Staff fill in the borrower's name and the books (one or many, with how many copies of each).
  Each library can also turn on a **public form**: anyone with the link can send a borrow request without logging
  in; staff then approve (or reject) it at the counter.
- **Return check.** When books come back, staff count what was actually handed back (good / damaged / lost) against
  what was borrowed before the borrow record is closed. Partial returns are allowed. The system records who checked it and
  who brought the books back.
- **Tracking.** The dashboard and lists always show what is out, what is overdue, pending requests, and the full
  history per borrower and per book.

The full product specification is in [`docs/SPEC.md`](docs/SPEC.md).

```
backend/    API (Node 22, Express 5, Prisma 7, PostgreSQL)      → see backend/README.md
frontend/   Web app (React 19, Vite 8, Tailwind v4, shadcn/ui)   → see frontend/README.md
docs/       SPEC.md (the source of truth)
```

## Prerequisites

- **Node.js 22** or newer (npm comes with it).
- **PostgreSQL** installed and running on `localhost:5432` with user `postgres` / password `postgres`
  (if your password is different, change it in `DATABASE_URL` in `backend/.env`).
  No PostgreSQL on that PC? See [Without an installed PostgreSQL](#without-an-installed-postgresql) below.

## First-time setup (from zero, also on a new PC)

**Terminal 1: backend**

```bash
cd backend
npm install
cp .env.example .env            # PowerShell: Copy-Item .env.example .env
npm run db:migrate              # creates the `lms` database and its tables
npm run db:seed                 # creates the admin account (admin@localhost / password123)
npm run dev                     # API on http://localhost:3000
```

**Terminal 2: frontend**

```bash
cd frontend
npm install
npm run dev                     # open http://localhost:5174
```

### First login

Sign in at http://localhost:5174 with the seeded admin account:

| Email | Password |
|---|---|
| `admin@localhost` | `password123` |

`npm run db:seed` can be run any time: it creates this account, or resets it to exactly these credentials (and makes
it an active Admin again) if it already exists. Then create accounts for the other staff under **Users** (role
*Staff*, or *Admin* for people who manage libraries and accounts). On a real server, change this password.

### Every day after that

Start `npm run dev` in `backend/` and `npm run dev` in `frontend/`, each in its own terminal, then open
http://localhost:5174.

### Without an installed PostgreSQL

`npm run db:local` (in `backend/`) runs a real PostgreSQL from an npm package, with its data in `backend/.pgdata/`.
Keep it running in its own terminal (Ctrl+C or `npm run db:stop` stops it). It uses port 5432 by default; if that
port is taken, set `DB_LOCAL_PORT=5433` in `backend/.env` and put the same port in `DATABASE_URL`.

## Public borrow form: turn it on and share the link

1. Go to **Libraries** → open the library.
2. Under **Public borrow form**, switch it **On** (admins only).
3. Click **Copy link** and share it (group chat, poster with a QR code, parish/school page). It looks like
   `http://<your-server>/borrow/<library-link-name>`.

Borrowers open the link, enter their name (and optionally ID number, contact, affiliation), pick the books and
submit. They get a **request number** (e.g. `BR-000123`) to show at the counter, and can check the status at
`/borrow/<library-link-name>/status`. Requests do not reserve books; stock is only taken when staff approve.
While the switch is off, the link shows a friendly "not available" page.

> The link only works for other people when the app runs on a machine they can reach (not `localhost`). See the
> backend README for production settings (`JWT_SECRET`, `CORS_ORIGIN`).

## Daily workflow (quick guide)

**Choose the library.** The **Library** switcher at the top of the sidebar decides what the dashboard, Borrow Records and
books show (*All libraries* or one). Forms that need one library pre-select it.

**Register books.**
- *Libraries* → library → **Categories** → **Add** (e.g. Filipiniana, Fiction, Reference).
- *Books* → **Add book**: the same large boxes as **Add many books**, for one book: **Which library?**, **Which
  category?** (or "+ New category…"), title, author (optional), copies (− / +) and a **picture (optional)**:
  **Choose a picture** (on a phone you can also take a photo; it is made smaller before saving). The picture shows in
  the first column of the Books list and, larger, on the book's page; **Edit** can change or remove it. The shelf
  number, ISBN, publisher, year and notes are added later with **Edit** (under **More details**).
- *Books* → **Add many books** (a full page with large text and buttons):
  1. **Which library?** and **Which category?** — chosen once for all the books on the page (or pick
     "+ New category…" and type its name). The page keeps the library you chose here even if the sidebar
     switcher is changed.
  2. **Type the books** — one book per line: the title, the author if known, and the number of copies (use the
     big − and + buttons, or the arrow keys; at most 999). Press **Enter** to go to the next line;
     **+ Add another book** adds more lines. Empty lines are skipped. **Remove** leaves a note in its place with a
     **Bring it back** button, in case it was pressed by mistake. Tip: copy a list of titles from Excel and paste
     it into a Title box to fill many lines at once (columns: title, author, copies; a first line of column names
     and a numbering column are skipped). A list of authors pasted into an Author box fills the authors down.
  3. Press **Save … books**. A line with a missing title gets a short message under it, and nothing is saved
     until it is fixed. After saving, choose **Add more books** or **Go to Books** (which shows the library the
     books went into).

  ISBN, call number and other details can be added later by editing a book. Leaving the page with unsaved
  books asks first, and leaving while the books are being saved asks you to wait.
- A book that has been borrowed can't be deleted; **archive** it instead (it stays in the history).

**Borrow books (over the counter).** **Borrow Books** → pick an existing borrower (search by name/ID) or enter a new
one → search and add books, set the number of copies → due date (blank = the library's default borrowing period) →
**Confirm Borrow**. The new borrow record gets a reference number (e.g. `BR-000123`).
Copies are taken from stock immediately. If someone else took the last copy meanwhile, the line is highlighted
and nothing is changed.

**Approve public requests.** *Borrow Records* → **Pending** tab (the sidebar shows how many are waiting). Open the request,
check the borrower's identity (a warning appears if the name typed on the form differs from the saved borrower),
then **Approve** (optionally change the due date). If a book has no copies left, use **Edit items** to reduce or
remove it and approve again. Otherwise **Reject** (a reason is required) or **⋯ → Cancel request** (e.g. the
borrower never came).

**Return check.** Open the borrow record (search its reference number or the borrower's name on *Borrow Records*)
→ **Return check**.
Every count starts at 0; enter how many came back **Good**, **Damaged** or **Lost** for each book (or press *All
good* / *All returned in good condition*), optionally who brought them back and notes → **Record return…** →
confirm. Good and damaged copies go back on the shelf; lost copies are removed from the book's total. If something
is still missing the record becomes *Partially returned*; when everything is accounted for it is *Returned*.

**Tracking.**
- **Dashboard**: pending requests, currently borrowed, overdue, returned this month, copies out, overdue list,
  recent activity.
- **Borrow Records** tabs: Pending · Borrowed · Overdue · Returned · All, with search by borrower, ID number or
  reference number (`BR-000123`).
- **Borrowers** → a borrower: everything they still have and their full history.
- **Books** → a book: copies, who has it right now (with due dates) and its borrowing history.
- To give more time, open the borrow record → **Extend due date**.

## Scripts reference

**backend/** (run inside `backend/`)

| Script | What it does |
|---|---|
| `npm run db:migrate` | Create/update the database tables |
| `npm run db:seed` | Create the admin account, or reset it to `admin@localhost` / `password123` |
| `npm run dev` | Start the API with auto-reload (http://localhost:3000) |
| `npm run build` / `npm start` | Compile to `dist/` / run the compiled API |
| `npm test` | Automated tests on the `lms` database — **erases all data**, then re-creates the admin account |
| `npm run db:local` | Only without an installed PostgreSQL: run the built-in one (keep its terminal open) |
| `npm run db:stop` | Stop that built-in PostgreSQL cleanly from another terminal |
| `npm run typecheck` | Type-check everything |
| `npm run db:deploy` | Apply migrations without prompts (production) |
| `npm run db:studio` | Browse the database in Prisma Studio |
| `npm run db:reset` | **Erase** the database, re-create it and re-seed (asks first) |

**frontend/** (run inside `frontend/`)

| Script | What it does |
|---|---|
| `npm run dev` | Start the web app (http://localhost:5174; `/api` is forwarded to the backend) |
| `npm run build` | Type-check and build for production (`dist/`) |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Lint with oxlint |

## Configuration

- `backend/.env` (copy of `backend/.env.example`): database URL, port, allowed browser origin, `JWT_SECRET`
  (**required in production**), time zone (`Asia/Manila`), the seed admin, and the optional `DB_LOCAL_PORT` /
  `TRUST_PROXY`. Details in [`backend/README.md`](backend/README.md).
- `frontend/.env` (optional, copy of `frontend/.env.example`): `API_PROXY_TARGET` if the backend is not on
  `http://localhost:3000`.
- `.env` files and `backend/.pgdata/` are local only and are git-ignored.
