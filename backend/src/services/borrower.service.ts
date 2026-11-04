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
  /** Already trimmed and lower-cased by the route's validation. */
  email?: string | null;
};

const idNumberTaken = () =>
  new HttpError(409, "ID_NUMBER_TAKEN", "Another borrower already has this ID number.");
export const borrowerEmailTaken = () =>
  new HttpError(409, "EMAIL_TAKEN", "Another borrower already has this email.");
const emailMismatch = () =>
  new HttpError(
    409,
    "EMAIL_MISMATCH",
    "This ID number is registered with a different email address. Please use that email or ask the library staff.",
  );
export const noEmail = () =>
  new HttpError(400, "NO_EMAIL", "This borrower has no email address. Add one to their details first.");

/**
 * Maps a unique violation on Borrower to EMAIL_TAKEN or ID_NUMBER_TAKEN by looking at what is actually taken (the
 * driver's error metadata is not relied on). Anything else is rethrown.
 */
async function mapBorrowerConflict(err: unknown, input: { email?: string | null }, exceptId?: string): Promise<never> {
  if (!isUniqueViolation(err)) throw err;
  if (input.email) {
    const other = await prisma.borrower.findFirst({
      where: { email: input.email, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (other) throw borrowerEmailTaken();
  }
  throw idNumberTaken();
}

/**
 * Staff "Borrow Books" with a new borrower typed in: finds the borrower with the given idNumber (their stored
 * details, email included, are NOT overwritten) or creates a new one. Race-safe: INSERT … ON CONFLICT DO NOTHING
 * followed by a lookup, so two concurrent requests with the same idNumber link to one borrower without aborting
 * the transaction. An email that already belongs to another borrower → 409 EMAIL_TAKEN.
 */
export async function resolveBorrower(db: Db, input: BorrowerInput): Promise<string> {
  const data = {
    name: input.name,
    idNumber: input.idNumber ?? null,
    contact: input.contact ?? null,
    affiliation: input.affiliation ?? null,
    email: input.email ?? null,
  };
  if (!data.idNumber) {
    // A duplicate email makes this insert fail (and the transaction with it); the caller maps it to EMAIL_TAKEN.
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
    // Nothing with this idNumber, yet the insert was skipped: the email belongs to someone else.
    if (data.email) {
      const [byEmail] = await db.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Borrower" WHERE "email" = ${data.email}`;
      if (byEmail) throw borrowerEmailTaken();
    }
  }
  throw new Error(`Could not resolve borrower with ID number ${data.idNumber}.`);
}

/**
 * Public borrow request: the borrower is identified by their email (required there).
 * 1. A borrower with that email → linked (their stored details are not overwritten).
 * 2. Else, with an idNumber that belongs to a borrower: no email yet → it gets this one; another email → 409
 *    EMAIL_MISMATCH (someone else's ID number, or a typo; staff can sort it out).
 * 3. Else a new borrower with that email.
 * Race-safe like `resolveBorrower`: rows are locked, inserts never fail (ON CONFLICT DO NOTHING) and the lookup is
 * repeated after a skipped insert. The one write that can still hit a unique violation (setting the email of an
 * ID-number match while another request inserts that email) aborts the transaction; createPublicRequest retries it.
 */
export async function resolvePublicBorrower(db: Db, input: BorrowerInput & { email: string }): Promise<string> {
  const data = {
    name: input.name,
    idNumber: input.idNumber ?? null,
    contact: input.contact ?? null,
    affiliation: input.affiliation ?? null,
    email: input.email,
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const [byEmail] = await db.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Borrower" WHERE "email" = ${data.email} FOR KEY SHARE`;
    if (byEmail) return byEmail.id;

    if (data.idNumber) {
      // FOR UPDATE: the email may be set below (a unique column, so FOR NO KEY UPDATE is not enough).
      const [byId] = await db.$queryRaw<{ id: string; email: string | null }[]>`
        SELECT "id", "email" FROM "Borrower" WHERE "idNumber" = ${data.idNumber} FOR UPDATE`;
      if (byId) {
        if (byId.email !== null && byId.email !== data.email) throw emailMismatch();
        if (byId.email === null) {
          await db.borrower.updateMany({ where: { id: byId.id, email: null }, data: { email: data.email } });
        }
        return byId.id;
      }
    }

    const created = await db.borrower.createMany({ data: [data], skipDuplicates: true });
    if (created.count === 1) {
      const [row] = await db.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Borrower" WHERE "email" = ${data.email} FOR KEY SHARE`;
      if (row) return row.id;
    }
    // Skipped: a concurrent request inserted this email or idNumber first. Look again.
  }
  throw new Error("Could not resolve the borrower of a public request.");
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

/** The sign-in account linked to a borrower (User.borrowerId), as shown on the borrower. */
const borrowerInclude = {
  user: { select: { id: true, email: true, active: true, mustChangePassword: true, role: { select: { id: true, name: true } } } },
} satisfies Prisma.BorrowerInclude;

type BorrowerRow = {
  id: string;
  name: string;
  email: string | null;
  user: {
    id: string;
    email: string;
    active: boolean;
    mustChangePassword: boolean;
    role: { id: string; name: string };
  } | null;
  idNumber: string | null;
  contact: string | null;
  affiliation: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * `Borrower` response. `hasAccount` / `mustChangePassword` / `account` describe the linked sign-in account (managed
 * in Users → Accounts like any other account); the deprecated Borrower password columns are never read.
 */
const serializeBorrower = (b: BorrowerRow, s: { activeLoans: number; outstandingCopies: number }) => ({
  id: b.id,
  name: b.name,
  email: b.email,
  hasAccount: b.user !== null,
  mustChangePassword: b.user?.mustChangePassword ?? false,
  account: b.user
    ? {
        id: b.user.id,
        email: b.user.email,
        role: { id: b.user.role.id, name: b.user.role.name },
        active: b.user.active,
      }
    : null,
  idNumber: b.idNumber,
  contact: b.contact,
  affiliation: b.affiliation,
  createdAt: b.createdAt.toISOString(),
  updatedAt: b.updatedAt.toISOString(),
  activeLoans: s.activeLoans,
  outstandingCopies: s.outstandingCopies,
});

async function getBorrowerSummary(id: string) {
  const b = await prisma.borrower.findUnique({ where: { id }, include: borrowerInclude });
  if (!b) throw notFound("Borrower");
  const stats = await openStats([id]);
  return serializeBorrower(b, stats.get(id)!);
}

export async function listBorrowers(query: Page & { q?: string; hasAccount?: boolean }) {
  const and: Prisma.BorrowerWhereInput[] = [];
  if (query.q) {
    and.push({
      OR: [
        { name: { contains: query.q, mode: "insensitive" } },
        { idNumber: { contains: query.q, mode: "insensitive" } },
        { contact: { contains: query.q, mode: "insensitive" } },
        { email: { contains: query.q, mode: "insensitive" } },
      ],
    });
  }
  // Based on the linked sign-in account (User.borrowerId).
  if (query.hasAccount !== undefined) and.push({ user: query.hasAccount ? { isNot: null } : { is: null } });
  const where: Prisma.BorrowerWhereInput = and.length ? { AND: and } : {};
  const [total, rows] = await Promise.all([
    prisma.borrower.count({ where }),
    prisma.borrower.findMany({ where, include: borrowerInclude, orderBy: [{ name: "asc" }, { id: "asc" }], ...skipTake(query) }),
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
        email: input.email ?? null,
      },
      include: borrowerInclude,
    });
    return serializeBorrower(b, { activeLoans: 0, outstandingCopies: 0 });
  } catch (err) {
    return mapBorrowerConflict(err, input);
  }
}

/**
 * Edits the borrower's details only. Their sign-in account (if any) is a separate `User` and is never touched here,
 * not even when the email changes: accounts are managed in Users → Accounts.
 */
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
        email: input.email,
      },
    });
  } catch (err) {
    await mapBorrowerConflict(err, input, id);
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
