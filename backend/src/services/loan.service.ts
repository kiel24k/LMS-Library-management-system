/**
 * Loan lifecycle, stock and returns. Every stock or status change runs inside a `$transaction` and uses
 * conditional atomic updates (see docs/SPEC.md "Stock rules"), so concurrent requests can never take
 * the same last copy, approve twice, or apply a return check twice.
 */
import { Prisma } from "../generated/prisma/client.js";
import type { LoanStatus } from "../generated/prisma/enums.js";
import { prisma, TX_OPTIONS, type Db, type Tx } from "../lib/prisma.js";
import { HttpError, invalidStatus, notFound, validationError, type Issue } from "../lib/http-error.js";
import { addDays, dateOnlyToDate, todayDateOnly } from "../lib/dates.js";
import { parseLoanNumber } from "../lib/loan-number.js";
import { skipTake, type Page } from "../lib/validation.js";
import {
  OPEN_STATUSES,
  itemOutstanding,
  loanDetailInclude,
  loanInclude,
  serializeLoan,
  serializeLoanDetail,
} from "./serializers.js";
import { resolveBorrower, type BorrowerInput } from "./borrower.service.js";

export type ItemInput = { bookId: string; quantity: number };

// ------------------------------------------------------------------ helpers

export async function getLoanDetail(id: string, db: Db = prisma) {
  const loan = await db.loan.findUnique({ where: { id }, include: loanDetailInclude });
  if (!loan) throw notFound("Borrow record");
  return serializeLoanDetail(loan);
}

/** Validates the dueDate (YYYY-MM-DD) is today or later in APP_TIMEZONE. */
function assertDueDateNotPast(dueDate: string | undefined, today: string) {
  if (dueDate !== undefined && dueDate < today) {
    throw validationError([{ path: ["dueDate"], message: "Due date cannot be in the past." }]);
  }
}

/** Duplicate bookIds within one item list → 400 VALIDATION_ERROR (path ["items", i, "bookId"]). */
export function assertDistinctBooks(items: ItemInput[]) {
  const seen = new Set<string>();
  const issues: Issue[] = [];
  items.forEach((it, i) => {
    if (seen.has(it.bookId)) issues.push({ path: ["items", i, "bookId"], message: "This book is already in the list." });
    seen.add(it.bookId);
  });
  if (issues.length) throw validationError(issues);
}

/**
 * Every book must exist, belong to `libraryId` and not be archived → else 400 INVALID_BOOKS.
 * `keepArchived`: books already on a PENDING request, which may stay there while archived (only approval
 * requires removing them).
 *
 * Call inside the transaction that inserts the loan items: the rows are locked FOR KEY SHARE, so a
 * concurrent book delete waits until the items exist (and then fails with BOOK_HAS_LOANS) instead of
 * slipping in between this check and the insert.
 */
export async function assertBooksUsable(db: Db, libraryId: string, bookIds: string[], keepArchived: string[] = []) {
  const books = bookIds.length
    ? await db.$queryRaw<{ id: string; libraryId: string; archived: boolean }[]>`
        SELECT "id", "libraryId", "archived" FROM "Book"
         WHERE "id" IN (${Prisma.join(bookIds)})
         ORDER BY "id"
           FOR KEY SHARE`
    : [];
  const byId = new Map(books.map((b) => [b.id, b]));
  const bad = bookIds.filter((id) => {
    const b = byId.get(id);
    return !b || b.libraryId !== libraryId || (b.archived && !keepArchived.includes(id));
  });
  if (bad.length) {
    throw new HttpError(
      400,
      "INVALID_BOOKS",
      bad.length === 1
        ? "One of the books is not available for borrowing in this library (missing, archived or from another library)."
        : `${bad.length} books are not available for borrowing in this library (missing, archived or from another library).`,
      { bookIds: bad },
    );
  }
}

/**
 * Atomically takes `quantity` copies of each book. All-or-nothing: if any book lacks copies the
 * whole transaction is rolled back with 409 INSUFFICIENT_COPIES listing every short book.
 */
async function takeCopies(tx: Tx, items: ItemInput[]) {
  // Fixed lock order (by bookId) avoids deadlocks between concurrent multi-book loans.
  const sorted = [...items].sort((a, b) => (a.bookId < b.bookId ? -1 : a.bookId > b.bookId ? 1 : 0));
  const short: ItemInput[] = [];
  for (const it of sorted) {
    const res = await tx.book.updateMany({
      where: { id: it.bookId, availableCopies: { gte: it.quantity } },
      data: { availableCopies: { decrement: it.quantity } },
    });
    if (res.count !== 1) short.push(it);
  }
  if (short.length) {
    const books = await tx.book.findMany({
      where: { id: { in: short.map((s) => s.bookId) } },
      select: { id: true, title: true, availableCopies: true },
    });
    const byId = new Map(books.map((b) => [b.id, b]));
    const details = short.map((s) => ({
      bookId: s.bookId,
      title: byId.get(s.bookId)?.title ?? "",
      requested: s.quantity,
      available: byId.get(s.bookId)?.availableCopies ?? 0,
    }));
    throw new HttpError(
      409,
      "INSUFFICIENT_COPIES",
      details.length === 1
        ? `Not enough copies of "${details[0]!.title}" are available (requested ${details[0]!.requested}, available ${details[0]!.available}).`
        : `Not enough copies are available for ${details.length} books.`,
      { books: details },
    );
  }
}

/** Re-reads the loan status to report a precise error after a conditional update matched nothing. */
async function statusConflict(tx: Tx, loanId: string, message?: (s: LoanStatus) => string): Promise<never> {
  const loan = await tx.loan.findUnique({ where: { id: loanId }, select: { status: true } });
  if (!loan) throw notFound("Borrow record");
  throw invalidStatus(loan.status, message?.(loan.status));
}

/** The loan's library, locked FOR KEY SHARE (see assertBooksUsable) → else 404. */
async function getLibraryForLoan(db: Db, libraryId: string) {
  const [library] = await db.$queryRaw<{ id: string; defaultLoanDays: number }[]>`
    SELECT "id", "defaultLoanDays" FROM "Library" WHERE "id" = ${libraryId} FOR KEY SHARE`;
  if (!library) throw notFound("Library");
  return library;
}

// ------------------------------------------------------------------ list

export type LoanListQuery = Page & {
  libraryId?: string;
  status?: LoanStatus[];
  borrowerId?: string;
  bookId?: string;
  overdue?: boolean;
  q?: string;
};

export function overdueWhere(today: string): Prisma.LoanWhereInput {
  return { status: { in: OPEN_STATUSES }, dueDate: { lt: dateOnlyToDate(today) } };
}

export async function listLoans(query: LoanListQuery) {
  const today = todayDateOnly();
  const and: Prisma.LoanWhereInput[] = [];
  if (query.libraryId) and.push({ libraryId: query.libraryId });
  if (query.status?.length) and.push({ status: { in: query.status } });
  if (query.borrowerId) and.push({ borrowerId: query.borrowerId });
  if (query.bookId) and.push({ items: { some: { bookId: query.bookId } } });
  if (query.overdue === true) and.push(overdueWhere(today));
  if (query.overdue === false) and.push({ NOT: overdueWhere(today) });
  if (query.q) {
    const or: Prisma.LoanWhereInput[] = [
      { borrower: { name: { contains: query.q, mode: "insensitive" } } },
      { borrower: { idNumber: { contains: query.q, mode: "insensitive" } } },
    ];
    const n = parseLoanNumber(query.q);
    if (n !== null) or.push({ number: n });
    and.push({ OR: or });
  }
  const where: Prisma.LoanWhereInput = and.length ? { AND: and } : {};
  const [total, rows] = await Promise.all([
    prisma.loan.count({ where }),
    prisma.loan.findMany({
      where,
      include: loanInclude,
      orderBy: [{ requestedAt: "desc" }, { number: "desc" }],
      ...skipTake(query),
    }),
  ]);
  return { data: rows.map((l) => serializeLoan(l, today)), total, page: query.page, pageSize: query.pageSize };
}

// ------------------------------------------------------------------ staff loan (→ BORROWED)

export type StaffLoanInput = {
  libraryId: string;
  borrowerId?: string;
  borrower?: BorrowerInput;
  items: ItemInput[];
  dueDate?: string;
  notes?: string | null;
};

export async function createStaffLoan(input: StaffLoanInput, userId: string) {
  assertDistinctBooks(input.items);
  const today = todayDateOnly();
  assertDueDateNotPast(input.dueDate, today);

  const loanId = await prisma.$transaction(async (tx) => {
    const library = await getLibraryForLoan(tx, input.libraryId);
    let borrowerId: string;
    if (input.borrowerId) {
      // FOR KEY SHARE: a concurrent borrower delete waits for this loan (then fails with BORROWER_HAS_LOANS).
      const [b] = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Borrower" WHERE "id" = ${input.borrowerId} FOR KEY SHARE`;
      if (!b) throw notFound("Borrower");
      borrowerId = b.id;
    } else {
      borrowerId = await resolveBorrower(tx, input.borrower!);
    }
    await assertBooksUsable(tx, library.id, input.items.map((i) => i.bookId));
    await takeCopies(tx, input.items);
    const now = new Date();
    const loan = await tx.loan.create({
      data: {
        libraryId: library.id,
        borrowerId,
        source: "STAFF",
        status: "BORROWED",
        requestedAt: now,
        borrowedAt: now,
        dueDate: dateOnlyToDate(input.dueDate ?? addDays(today, library.defaultLoanDays)),
        notes: input.notes ?? null,
        createdById: userId,
        approvedById: userId,
        items: { create: input.items.map((it) => ({ bookId: it.bookId, quantity: it.quantity })) },
      },
      select: { id: true },
    });
    return loan.id;
  }, TX_OPTIONS);
  return getLoanDetail(loanId);
}

// ------------------------------------------------------------------ public request (→ PENDING)

export type PublicRequestInput = {
  borrower: BorrowerInput;
  items: ItemInput[];
  notes?: string | null;
};

export async function createPublicRequest(libraryId: string, input: PublicRequestInput) {
  assertDistinctBooks(input.items);
  return prisma.$transaction(async (tx) => {
    await getLibraryForLoan(tx, libraryId);
    await assertBooksUsable(tx, libraryId, input.items.map((i) => i.bookId));
    const borrowerId = await resolveBorrower(tx, input.borrower);
    const loan = await tx.loan.create({
      data: {
        libraryId,
        borrowerId,
        source: "PUBLIC_FORM",
        status: "PENDING",
        requestedAt: new Date(),
        notes: input.notes ?? null,
        submittedName: input.borrower.name,
        items: { create: input.items.map((it) => ({ bookId: it.bookId, quantity: it.quantity })) },
      },
      select: { number: true, status: true },
    });
    return loan;
  }, TX_OPTIONS);
}

// ------------------------------------------------------------------ PATCH

export type LoanPatchInput = { items?: ItemInput[]; notes?: string | null; dueDate?: string };

export async function updateLoan(id: string, input: LoanPatchInput) {
  const today = todayDateOnly();
  assertDueDateNotPast(input.dueDate, today);
  if (input.items) assertDistinctBooks(input.items);

  // Statuses in which every requested change is allowed.
  let allowed: LoanStatus[] = ["PENDING", "BORROWED", "PARTIALLY_RETURNED"];
  if (input.items) allowed = allowed.filter((s) => s === "PENDING");
  if (input.dueDate !== undefined) allowed = allowed.filter((s) => OPEN_STATUSES.includes(s));

  await prisma.$transaction(async (tx) => {
    const data: Prisma.LoanUpdateManyMutationInput = { updatedAt: new Date() };
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.dueDate !== undefined) data.dueDate = dateOnlyToDate(input.dueDate);
    // Conditional update on status: locks the loan row and re-checks the status atomically.
    const res = await tx.loan.updateMany({ where: { id, status: { in: allowed } }, data });
    if (res.count !== 1) {
      await statusConflict(tx, id, (s) =>
        input.items && s !== "PENDING"
          ? "Items can only be changed while the request is pending."
          : input.dueDate !== undefined && !OPEN_STATUSES.includes(s)
            ? "The due date can only be changed while the books are borrowed."
            : `This borrow record can no longer be edited (it is ${s}).`,
      );
    }
    if (input.items) {
      const loan = await tx.loan.findUniqueOrThrow({
        where: { id },
        select: { libraryId: true, items: { select: { bookId: true } } },
      });
      // Archived books cannot be added, but lines already on the request may stay until approval.
      const current = loan.items.map((it) => it.bookId);
      await assertBooksUsable(tx, loan.libraryId, input.items.map((i) => i.bookId), current);
      await tx.loanItem.deleteMany({ where: { loanId: id } });
      await tx.loanItem.createMany({
        data: input.items.map((it) => ({ loanId: id, bookId: it.bookId, quantity: it.quantity })),
      });
    }
  }, TX_OPTIONS);
  return getLoanDetail(id);
}

// ------------------------------------------------------------------ transitions

export async function approveLoan(id: string, input: { dueDate?: string }, userId: string) {
  const today = todayDateOnly();
  assertDueDateNotPast(input.dueDate, today);
  await prisma.$transaction(async (tx) => {
    const loan = await tx.loan.findUnique({
      where: { id },
      select: { libraryId: true, library: { select: { defaultLoanDays: true } } },
    });
    if (!loan) throw notFound("Borrow record");
    const now = new Date();
    const dueDate = input.dueDate ?? addDays(today, loan.library.defaultLoanDays);
    // PENDING → BORROWED, conditional on the current status (a double approve matches nothing).
    const res = await tx.loan.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "BORROWED", borrowedAt: now, approvedById: userId, dueDate: dateOnlyToDate(dueDate) },
    });
    if (res.count !== 1) await statusConflict(tx, id, (s) => `Only pending requests can be approved (this record is ${s}).`);

    const items = await tx.loanItem.findMany({ where: { loanId: id }, select: { bookId: true, quantity: true } });
    if (items.length === 0) {
      throw validationError([{ path: ["items"], message: "The request has no books." }], "The request has no books to approve.");
    }
    await assertBooksUsable(tx, loan.libraryId, items.map((i) => i.bookId));
    await takeCopies(tx, items);
  }, TX_OPTIONS);
  return getLoanDetail(id);
}

async function closePending(id: string, status: "REJECTED" | "CANCELLED", reason: string | null | undefined, userId: string) {
  await prisma.$transaction(async (tx) => {
    const data: Prisma.LoanUncheckedUpdateManyInput = { status, closedAt: new Date(), closedById: userId };
    if (reason) data.staffNotes = reason;
    const res = await tx.loan.updateMany({ where: { id, status: "PENDING" }, data });
    if (res.count !== 1) {
      await statusConflict(
        tx,
        id,
        (s) => `Only pending requests can be ${status === "REJECTED" ? "rejected" : "cancelled"} (this record is ${s}).`,
      );
    }
  });
  return getLoanDetail(id);
}

export const rejectLoan = (id: string, reason: string, userId: string) => closePending(id, "REJECTED", reason, userId);
export const cancelLoan = (id: string, reason: string | null | undefined, userId: string) =>
  closePending(id, "CANCELLED", reason, userId);

// ------------------------------------------------------------------ returns

export type ReturnInput = {
  items: { loanItemId: string; good: number; damaged: number; lost: number }[];
  returnedByName?: string | null;
  notes?: string | null;
};

export async function recordReturn(id: string, input: ReturnInput, userId: string) {
  // Shape checks that do not need the database.
  const issues: Issue[] = [];
  const seen = new Set<string>();
  input.items.forEach((it, i) => {
    if (seen.has(it.loanItemId)) issues.push({ path: ["items", i, "loanItemId"], message: "Each item can be listed only once." });
    seen.add(it.loanItemId);
  });
  if (issues.length) throw validationError(issues);
  const totalCounted = input.items.reduce((s, it) => s + it.good + it.damaged + it.lost, 0);
  if (totalCounted === 0) {
    throw validationError([{ path: ["items"], message: "Enter at least one returned, damaged or lost copy." }], "Nothing was counted as returned.");
  }

  await prisma.$transaction(async (tx) => {
    const now = new Date();
    // Lock the loan row and check it is open; concurrent return checks queue here and then see fresh counts.
    const lock = await tx.loan.updateMany({ where: { id, status: { in: OPEN_STATUSES } }, data: { updatedAt: now } });
    if (lock.count !== 1) await statusConflict(tx, id, (s) => `Returns can only be recorded while books are borrowed (this record is ${s}).`);

    const loanItems = await tx.loanItem.findMany({ where: { loanId: id } });
    const byId = new Map(loanItems.map((li) => [li.id, li]));

    const foreign: Issue[] = [];
    input.items.forEach((it, i) => {
      if (!byId.has(it.loanItemId)) foreign.push({ path: ["items", i, "loanItemId"], message: "This item does not belong to this borrow record." });
    });
    if (foreign.length) throw validationError(foreign);

    const exceeding = input.items.filter((it) => {
      const li = byId.get(it.loanItemId)!;
      return it.good + it.damaged + it.lost > itemOutstanding("BORROWED", li);
    });
    if (exceeding.length) {
      throw new HttpError(
        400,
        "RETURN_EXCEEDS_OUTSTANDING",
        "More copies were entered than are still outstanding for some items.",
        { loanItemIds: exceeding.map((e) => e.loanItemId) },
      );
    }

    const counted = input.items.filter((it) => it.good + it.damaged + it.lost > 0);
    // Stable order for book row locks.
    counted.sort((a, b) => {
      const ba = byId.get(a.loanItemId)!.bookId;
      const bb = byId.get(b.loanItemId)!.bookId;
      return ba < bb ? -1 : ba > bb ? 1 : 0;
    });
    for (const it of counted) {
      const li = byId.get(it.loanItemId)!;
      await tx.loanItem.update({
        where: { id: li.id },
        data: {
          returnedGood: { increment: it.good },
          returnedDamaged: { increment: it.damaged },
          lost: { increment: it.lost },
        },
      });
      const back = it.good + it.damaged;
      if (back > 0 || it.lost > 0) {
        await tx.book.update({
          where: { id: li.bookId },
          data: {
            ...(back > 0 ? { availableCopies: { increment: back } } : {}),
            ...(it.lost > 0 ? { totalCopies: { decrement: it.lost } } : {}),
          },
        });
      }
    }

    await tx.returnRecord.create({
      data: {
        loanId: id,
        receivedById: userId,
        receivedAt: now,
        returnedByName: input.returnedByName ?? null,
        notes: input.notes ?? null,
        items: {
          create: counted.map((it) => ({ loanItemId: it.loanItemId, good: it.good, damaged: it.damaged, lost: it.lost })),
        },
      },
    });

    const remaining = loanItems.reduce((sum, li) => {
      const it = input.items.find((x) => x.loanItemId === li.id);
      const extra = it ? it.good + it.damaged + it.lost : 0;
      return sum + itemOutstanding("BORROWED", li) - extra;
    }, 0);
    await tx.loan.update({
      where: { id },
      data:
        remaining === 0
          ? { status: "RETURNED", closedAt: now, closedById: userId }
          : { status: "PARTIALLY_RETURNED" },
    });
  }, TX_OPTIONS);
  return getLoanDetail(id);
}

