import type { Prisma } from "../generated/prisma/client.js";
import { prisma, type Db } from "../lib/prisma.js";
import { HttpError, notFound } from "../lib/http-error.js";
import { isForeignKeyViolation, isUniqueViolation } from "../lib/prisma-errors.js";
import { todayDateOnly } from "../lib/dates.js";
import { skipTake, type Page } from "../lib/validation.js";
import { OPEN_STATUSES, itemOutstanding, loanInclude, serializeLoan } from "./serializers.js";

export type BorrowerInput = {
  name: string;
  idNumber?: string | null;
  contact?: string | null;
  affiliation?: string | null;
};

const idNumberTaken = () =>
  new HttpError(409, "ID_NUMBER_TAKEN", "Another borrower already has this ID number.");

/**
 * Finds the borrower with the given idNumber (their stored details are NOT overwritten) or creates a
 * new one. Race-safe: INSERT … ON CONFLICT DO NOTHING followed by a lookup, so two concurrent requests
 * with the same idNumber link to one borrower without aborting the transaction.
 */
export async function resolveBorrower(db: Db, input: BorrowerInput): Promise<string> {
  const data = {
    name: input.name,
    idNumber: input.idNumber ?? null,
    contact: input.contact ?? null,
    affiliation: input.affiliation ?? null,
  };
  if (!data.idNumber) {
    const created = await db.borrower.create({ data, select: { id: true } });
    return created.id;
  }
  // The lookup locks the row FOR KEY SHARE, so a concurrent delete of that borrower waits until the caller's
  // loan exists (then fails with BORROWER_HAS_LOANS); if it was deleted in between, the insert is retried.
  for (let attempt = 0; attempt < 3; attempt++) {
    await db.borrower.createMany({ data: [data], skipDuplicates: true });
    const [found] = await db.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Borrower" WHERE "idNumber" = ${data.idNumber} FOR KEY SHARE`;
    if (found) return found.id;
  }
  throw new Error(`Could not resolve borrower with ID number ${data.idNumber}.`);
}

/** activeLoans / outstandingCopies per borrower, computed over open loans. */
async function openStats(borrowerIds: string[]) {
  const stats = new Map<string, { activeLoans: number; outstandingCopies: number }>();
  for (const id of borrowerIds) stats.set(id, { activeLoans: 0, outstandingCopies: 0 });
  if (borrowerIds.length === 0) return stats;
  const loans = await prisma.loan.findMany({
    where: { borrowerId: { in: borrowerIds }, status: { in: OPEN_STATUSES } },
    select: {
      borrowerId: true,
      status: true,
      items: { select: { quantity: true, returnedGood: true, returnedDamaged: true, lost: true } },
    },
  });
  for (const l of loans) {
    const s = stats.get(l.borrowerId)!;
    s.activeLoans += 1;
    s.outstandingCopies += l.items.reduce((sum, it) => sum + itemOutstanding(l.status, it), 0);
  }
  return stats;
}

type BorrowerRow = {
  id: string;
  name: string;
  idNumber: string | null;
  contact: string | null;
  affiliation: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const serializeBorrower = (b: BorrowerRow, s: { activeLoans: number; outstandingCopies: number }) => ({
  id: b.id,
  name: b.name,
  idNumber: b.idNumber,
  contact: b.contact,
  affiliation: b.affiliation,
  createdAt: b.createdAt.toISOString(),
  updatedAt: b.updatedAt.toISOString(),
  activeLoans: s.activeLoans,
  outstandingCopies: s.outstandingCopies,
});

async function getBorrowerSummary(id: string) {
  const b = await prisma.borrower.findUnique({ where: { id } });
  if (!b) throw notFound("Borrower");
  const stats = await openStats([id]);
  return serializeBorrower(b, stats.get(id)!);
}

export async function listBorrowers(query: Page & { q?: string }) {
  const where: Prisma.BorrowerWhereInput = query.q
    ? {
        OR: [
          { name: { contains: query.q, mode: "insensitive" } },
          { idNumber: { contains: query.q, mode: "insensitive" } },
          { contact: { contains: query.q, mode: "insensitive" } },
        ],
      }
    : {};
  const [total, rows] = await Promise.all([
    prisma.borrower.count({ where }),
    prisma.borrower.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], ...skipTake(query) }),
  ]);
  const stats = await openStats(rows.map((r) => r.id));
  return {
    data: rows.map((r) => serializeBorrower(r, stats.get(r.id)!)),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getBorrowerDetail(id: string) {
  const summary = await getBorrowerSummary(id);
  const today = todayDateOnly();
  const loans = await prisma.loan.findMany({
    where: { borrowerId: id },
    include: loanInclude,
    orderBy: [{ requestedAt: "desc" }, { number: "desc" }],
  });
  return { ...summary, loans: loans.map((l) => serializeLoan(l, today)) };
}

export async function createBorrower(input: BorrowerInput) {
  try {
    const b = await prisma.borrower.create({
      data: {
        name: input.name,
        idNumber: input.idNumber ?? null,
        contact: input.contact ?? null,
        affiliation: input.affiliation ?? null,
      },
    });
    return serializeBorrower(b, { activeLoans: 0, outstandingCopies: 0 });
  } catch (err) {
    if (isUniqueViolation(err)) throw idNumberTaken();
    throw err;
  }
}

export async function updateBorrower(id: string, input: Partial<BorrowerInput>) {
  const exists = await prisma.borrower.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw notFound("Borrower");
  try {
    await prisma.borrower.update({
      where: { id },
      data: {
        name: input.name,
        idNumber: input.idNumber,
        contact: input.contact,
        affiliation: input.affiliation,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw idNumberTaken();
    throw err;
  }
  return getBorrowerSummary(id);
}

export async function deleteBorrower(id: string) {
  const b = await prisma.borrower.findUnique({ where: { id }, select: { id: true, _count: { select: { loans: true } } } });
  if (!b) throw notFound("Borrower");
  if (b._count.loans > 0) {
    throw new HttpError(409, "BORROWER_HAS_LOANS", "This borrower has borrowing history and cannot be deleted.");
  }
  try {
    await prisma.borrower.delete({ where: { id } });
  } catch (err) {
    // A loan may have been created concurrently (FK restrict).
    if (isForeignKeyViolation(err)) {
      throw new HttpError(409, "BORROWER_HAS_LOANS", "This borrower has borrowing history and cannot be deleted.");
    }
    throw err;
  }
}
