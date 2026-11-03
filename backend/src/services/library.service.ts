import { prisma } from "../lib/prisma.js";
import { HttpError, notFound } from "../lib/http-error.js";
import { isForeignKeyViolation, isUniqueViolation } from "../lib/prisma-errors.js";
import { slugCandidate, slugify } from "../lib/slug.js";
import { OPEN_STATUSES } from "./serializers.js";

export type LibraryInput = {
  name: string;
  slug?: string;
  description?: string | null;
  location?: string | null;
  publicFormEnabled?: boolean;
  defaultLoanDays?: number;
};

type LibraryRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  location: string | null;
  publicFormEnabled: boolean;
  defaultLoanDays: number;
  createdAt: Date;
  updatedAt: Date;
};

type Counts = { books: number; copies: number; available: number; activeLoans: number; pendingRequests: number; categories: number };
const emptyCounts = (): Counts => ({ books: 0, copies: 0, available: 0, activeLoans: 0, pendingRequests: 0, categories: 0 });

async function countsFor(libraryIds?: string[]): Promise<Map<string, Counts>> {
  const libFilter = libraryIds ? { libraryId: { in: libraryIds } } : {};
  const [books, loans, categories] = await Promise.all([
    prisma.book.groupBy({
      by: ["libraryId"],
      where: { ...libFilter, archived: false },
      _count: { _all: true },
      _sum: { totalCopies: true, availableCopies: true },
    }),
    prisma.loan.groupBy({
      by: ["libraryId", "status"],
      where: { ...libFilter, status: { in: [...OPEN_STATUSES, "PENDING"] } },
      _count: { _all: true },
    }),
    prisma.category.groupBy({ by: ["libraryId"], where: libFilter, _count: { _all: true } }),
  ]);
  const map = new Map<string, Counts>();
  const get = (id: string) => {
    let c = map.get(id);
    if (!c) map.set(id, (c = emptyCounts()));
    return c;
  };
  for (const b of books) {
    const c = get(b.libraryId);
    c.books = b._count._all;
    c.copies = b._sum.totalCopies ?? 0;
    c.available = b._sum.availableCopies ?? 0;
  }
  for (const l of loans) {
    const c = get(l.libraryId);
    if (l.status === "PENDING") c.pendingRequests += l._count._all;
    else c.activeLoans += l._count._all;
  }
  for (const cat of categories) get(cat.libraryId).categories = cat._count._all;
  return map;
}

const serializeLibrary = (l: LibraryRow, counts: Counts) => ({
  id: l.id,
  name: l.name,
  slug: l.slug,
  description: l.description,
  location: l.location,
  publicFormEnabled: l.publicFormEnabled,
  defaultLoanDays: l.defaultLoanDays,
  createdAt: l.createdAt.toISOString(),
  updatedAt: l.updatedAt.toISOString(),
  counts,
});

export async function listLibraries() {
  const [rows, counts] = await Promise.all([
    prisma.library.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }] }),
    countsFor(),
  ]);
  return { data: rows.map((l) => serializeLibrary(l, counts.get(l.id) ?? emptyCounts())) };
}

export async function getLibrary(id: string) {
  const l = await prisma.library.findUnique({ where: { id } });
  if (!l) throw notFound("Library");
  const counts = await countsFor([id]);
  return serializeLibrary(l, counts.get(id) ?? emptyCounts());
}

const slugTaken = () => new HttpError(409, "SLUG_TAKEN", "This link name (slug) is already used by another library.");

async function generateUniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  const taken = new Set(
    (await prisma.library.findMany({ where: { slug: { startsWith: base.slice(0, 50) } }, select: { slug: true } })).map((r) => r.slug),
  );
  for (let n = 1; ; n++) {
    const candidate = slugCandidate(base, n);
    if (!taken.has(candidate)) return candidate;
  }
}

export async function createLibrary(input: LibraryInput) {
  const data = {
    name: input.name,
    description: input.description ?? null,
    location: input.location ?? null,
    publicFormEnabled: input.publicFormEnabled ?? false,
    defaultLoanDays: input.defaultLoanDays ?? 7,
  };
  if (input.slug) {
    try {
      const l = await prisma.library.create({ data: { ...data, slug: input.slug } });
      return getLibrary(l.id);
    } catch (err) {
      if (isUniqueViolation(err)) throw slugTaken();
      throw err;
    }
  }
  // Generated slug: retry on a concurrent collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = await generateUniqueSlug(input.name);
    try {
      const l = await prisma.library.create({ data: { ...data, slug } });
      return getLibrary(l.id);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw slugTaken();
}

export async function updateLibrary(id: string, input: Partial<LibraryInput>) {
  const exists = await prisma.library.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw notFound("Library");
  try {
    await prisma.library.update({
      where: { id },
      data: {
        name: input.name,
        slug: input.slug,
        description: input.description,
        location: input.location,
        publicFormEnabled: input.publicFormEnabled,
        defaultLoanDays: input.defaultLoanDays,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw slugTaken();
    throw err;
  }
  return getLibrary(id);
}

export async function deleteLibrary(id: string) {
  const l = await prisma.library.findUnique({
    where: { id },
    select: { _count: { select: { books: true, loans: true } } },
  });
  if (!l) throw notFound("Library");
  const notEmpty = () =>
    new HttpError(409, "LIBRARY_NOT_EMPTY", "This library still has books or borrowing history. Remove its books first; libraries with borrow records cannot be deleted.");
  if (l._count.books > 0 || l._count.loans > 0) throw notEmpty();
  try {
    await prisma.library.delete({ where: { id } }); // categories cascade
  } catch (err) {
    if (isForeignKeyViolation(err)) throw notEmpty();
    throw err;
  }
}
