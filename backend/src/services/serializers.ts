/**
 * Prisma includes + serializers producing the exact response shapes of docs/SPEC.md ("Response shapes").
 * Nullable fields are always present (null, never omitted); timestamps are ISO strings; dueDate is YYYY-MM-DD.
 */
import type { Prisma } from "../generated/prisma/client.js";
import type { LoanStatus } from "../generated/prisma/enums.js";
import { formatLoanNumber } from "../lib/loan-number.js";
import { dateToDateOnly, overdueInfo, todayDateOnly } from "../lib/dates.js";

export const OPEN_STATUSES: LoanStatus[] = ["BORROWED", "PARTIALLY_RETURNED"];
export const CLOSED_STATUSES: LoanStatus[] = ["RETURNED", "REJECTED", "CANCELLED"];
/** Statuses in which items were actually handed out (outstanding is meaningful). */
const HANDED_OUT: LoanStatus[] = ["BORROWED", "PARTIALLY_RETURNED", "RETURNED"];

export const isOpenStatus = (s: LoanStatus) => OPEN_STATUSES.includes(s);

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);
const ref = (r: { id: string; name: string } | null) => (r ? { id: r.id, name: r.name } : null);

// ---------------------------------------------------------------- users

export type UserRow = { id: string; email: string; name: string; role: string; active: boolean; createdAt: Date };
export const serializeUser = (u: UserRow) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  active: u.active,
  createdAt: iso(u.createdAt),
});

// ---------------------------------------------------------------- books

export const bookInclude = {
  library: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  cover: { select: { updatedAt: true } }, // never the picture bytes; GET /books/:id/cover serves them
} satisfies Prisma.BookInclude;
export type BookRow = Prisma.BookGetPayload<{ include: typeof bookInclude }>;

/** ?v= changes with every new picture, so each URL can be cached for good. */
const coverUrl = (bookId: string, updatedAt: Date) => `/api/books/${encodeURIComponent(bookId)}/cover?v=${updatedAt.getTime()}`;

export const serializeBook = (b: BookRow) => ({
  id: b.id,
  libraryId: b.libraryId,
  library: { id: b.library.id, name: b.library.name },
  categoryId: b.categoryId,
  category: ref(b.category),
  title: b.title,
  author: b.author,
  isbn: b.isbn,
  publisher: b.publisher,
  publicationYear: b.publicationYear,
  callNumber: b.callNumber,
  totalCopies: b.totalCopies,
  availableCopies: b.availableCopies,
  onLoan: b.totalCopies - b.availableCopies,
  notes: b.notes,
  archived: b.archived,
  createdAt: iso(b.createdAt),
  updatedAt: iso(b.updatedAt),
  coverUrl: b.cover ? coverUrl(b.id, b.cover.updatedAt) : null,
});

// ---------------------------------------------------------------- loans

export const loanInclude = {
  library: { select: { id: true, name: true } },
  borrower: { select: { id: true, name: true, idNumber: true, contact: true, affiliation: true } },
  items: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { book: { select: { id: true, title: true, author: true, callNumber: true, archived: true } } },
  },
} satisfies Prisma.LoanInclude;
export type LoanRow = Prisma.LoanGetPayload<{ include: typeof loanInclude }>;

const userRef = { select: { id: true, name: true } } as const;
export const loanDetailInclude = {
  ...loanInclude,
  createdBy: userRef,
  approvedBy: userRef,
  closedBy: userRef,
  returns: {
    orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
    include: {
      receivedBy: userRef,
      items: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: { loanItem: { select: { bookId: true, book: { select: { title: true } } } } },
      },
    },
  },
} satisfies Prisma.LoanInclude;
export type LoanDetailRow = Prisma.LoanGetPayload<{ include: typeof loanDetailInclude }>;

type ItemCounts = { quantity: number; returnedGood: number; returnedDamaged: number; lost: number };
export function itemOutstanding(status: LoanStatus, it: ItemCounts): number {
  if (!HANDED_OUT.includes(status)) return 0;
  return Math.max(0, it.quantity - it.returnedGood - it.returnedDamaged - it.lost);
}

export function serializeLoan(l: LoanRow, today: string = todayDateOnly()) {
  const items = l.items.map((it) => ({
    id: it.id,
    bookId: it.bookId,
    book: {
      id: it.book.id,
      title: it.book.title,
      author: it.book.author,
      callNumber: it.book.callNumber,
      archived: it.book.archived,
    },
    quantity: it.quantity,
    returnedGood: it.returnedGood,
    returnedDamaged: it.returnedDamaged,
    lost: it.lost,
    outstanding: itemOutstanding(l.status, it),
  }));
  const dueDate = l.dueDate ? dateToDateOnly(l.dueDate) : null;
  return {
    id: l.id,
    number: l.number,
    loanNumber: formatLoanNumber(l.number),
    libraryId: l.libraryId,
    library: { id: l.library.id, name: l.library.name },
    borrower: {
      id: l.borrower.id,
      name: l.borrower.name,
      idNumber: l.borrower.idNumber,
      contact: l.borrower.contact,
      affiliation: l.borrower.affiliation,
    },
    source: l.source,
    status: l.status,
    requestedAt: iso(l.requestedAt),
    borrowedAt: isoOrNull(l.borrowedAt),
    dueDate,
    closedAt: isoOrNull(l.closedAt),
    notes: l.notes,
    staffNotes: l.staffNotes,
    submittedName: l.submittedName,
    items,
    totalQuantity: items.reduce((s, it) => s + it.quantity, 0),
    outstandingTotal: items.reduce((s, it) => s + it.outstanding, 0),
    ...overdueInfo(dueDate, isOpenStatus(l.status), today),
  };
}

export function serializeLoanDetail(l: LoanDetailRow, today: string = todayDateOnly()) {
  return {
    ...serializeLoan(l, today),
    createdBy: ref(l.createdBy),
    approvedBy: ref(l.approvedBy),
    closedBy: ref(l.closedBy),
    returns: l.returns.map((r) => ({
      id: r.id,
      receivedAt: iso(r.receivedAt),
      receivedBy: { id: r.receivedBy.id, name: r.receivedBy.name },
      returnedByName: r.returnedByName,
      notes: r.notes,
      items: r.items.map((ri) => ({
        id: ri.id,
        loanItemId: ri.loanItemId,
        bookId: ri.loanItem.bookId,
        bookTitle: ri.loanItem.book.title,
        good: ri.good,
        damaged: ri.damaged,
        lost: ri.lost,
      })),
    })),
  };
}

export type LoanDto = ReturnType<typeof serializeLoan>;
export type LoanDetailDto = ReturnType<typeof serializeLoanDetail>;
