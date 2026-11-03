import { Prisma } from "../generated/prisma/client.js";
import { prisma, TX_OPTIONS, type Db, type Tx } from "../lib/prisma.js";
import { HttpError, notFound } from "../lib/http-error.js";
import { isForeignKeyViolation } from "../lib/prisma-errors.js";
import { dateToDateOnly, todayDateOnly, overdueInfo } from "../lib/dates.js";
import { formatLoanNumber } from "../lib/loan-number.js";
import { skipTake, type Page } from "../lib/validation.js";
import { OPEN_STATUSES, bookInclude, itemOutstanding, serializeBook } from "./serializers.js";

export type BookInput = {
  title: string;
  author?: string | null;
  isbn?: string | null;
  publisher?: string | null;
  publicationYear?: number | null;
  callNumber?: string | null;
  totalCopies?: number;
  categoryId?: string | null;
  categoryName?: string | null;
  notes?: string | null;
};

export type BookPatchInput = Partial<BookInput> & { archived?: boolean };

const invalidCategory = () =>
  new HttpError(400, "INVALID_CATEGORY", "The selected grouping does not belong to this book's library.");

/**
 * Case-insensitive lookup of a category of `libraryId` by name (the same rule as the unique index on
 * ("libraryId", lower("name"))). FOR KEY SHARE keeps a concurrent delete of that category waiting until
 * the calling transaction has inserted its reference to it.
 */
async function lockCategoryByName(db: Db, libraryId: string, name: string) {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Category"
     WHERE "libraryId" = ${libraryId} AND lower("name") = lower(${name})
       FOR KEY SHARE`;
  return rows[0] ?? null;
}

/**
 * Resolves categoryId / categoryName to a category id of `libraryId` (call inside a transaction).
 * undefined → unchanged, null → no category. `categoryName` matches case-insensitively or creates it;
 * `created` is set only when this call inserted the category.
 */
async function resolveCategory(
  db: Db,
  libraryId: string,
  input: { categoryId?: string | null; categoryName?: string | null },
): Promise<{ id: string | null | undefined; created?: string }> {
  if (input.categoryId !== undefined) {
    if (input.categoryId === null) return { id: null };
    const [c] = await db.$queryRaw<{ libraryId: string }[]>`
      SELECT "libraryId" FROM "Category" WHERE "id" = ${input.categoryId} FOR KEY SHARE`;
    if (!c || c.libraryId !== libraryId) throw invalidCategory();
    return { id: input.categoryId };
  }
  if (input.categoryName !== undefined) {
    if (input.categoryName === null) return { id: null };
    // A concurrent request may create (or delete) the same name between our statements, so retry a few times.
    for (let attempt = 0; attempt < 3; attempt++) {
      const existing = await lockCategoryByName(db, libraryId, input.categoryName);
      if (existing) return { id: existing.id };
      // ON CONFLICT DO NOTHING (any unique index, including the case-insensitive one) keeps a concurrent
      // insert of the same name in any capitalisation from aborting the transaction; only rows this call
      // actually inserted are returned.
      const [created] = await db.category.createManyAndReturn({
        data: [{ libraryId, name: input.categoryName }],
        skipDuplicates: true,
        select: { id: true, name: true },
      });
      if (created) return { id: created.id, created: created.name };
    }
    throw new Error(`Could not resolve category "${input.categoryName}" in library ${libraryId}.`);
  }
  return { id: undefined };
}

async function getBookRow(db: Db, id: string) {
  const b = await db.book.findUnique({ where: { id }, include: bookInclude });
  if (!b) throw notFound("Book");
  return b;
}

// ------------------------------------------------------------------ list / detail

export type BookListQuery = Page & {
  libraryId?: string;
  categoryId?: string;
  q?: string;
  available?: boolean;
  includeArchived?: boolean;
};

export async function listBooks(query: BookListQuery) {
  const and: Prisma.BookWhereInput[] = [];
  if (query.libraryId) and.push({ libraryId: query.libraryId });
  if (query.categoryId) and.push({ categoryId: query.categoryId });
  if (query.includeArchived !== true) and.push({ archived: false });
  if (query.available === true) and.push({ availableCopies: { gt: 0 } });
  if (query.available === false) and.push({ availableCopies: 0 });
  if (query.q) {
    and.push({
      OR: (["title", "author", "isbn", "callNumber"] as const).map((f) => ({
        [f]: { contains: query.q, mode: "insensitive" },
      })),
    });
  }
  const where: Prisma.BookWhereInput = and.length ? { AND: and } : {};
  const [total, rows] = await Promise.all([
    prisma.book.count({ where }),
    prisma.book.findMany({ where, include: bookInclude, orderBy: [{ title: "asc" }, { id: "asc" }], ...skipTake(query) }),
  ]);
  return { data: rows.map(serializeBook), total, page: query.page, pageSize: query.pageSize };
}

export async function getBookDetail(id: string) {
  const book = await getBookRow(prisma, id);
  const today = todayDateOnly();
  const items = await prisma.loanItem.findMany({
    where: { bookId: id, loan: { status: { in: OPEN_STATUSES } } },
    include: {
      loan: { select: { id: true, number: true, status: true, dueDate: true, borrower: { select: { id: true, name: true } } } },
    },
  });
  const currentLoans = items
    .map((it) => {
      const dueDate = it.loan.dueDate ? dateToDateOnly(it.loan.dueDate) : null;
      return {
        loanId: it.loan.id,
        loanNumber: formatLoanNumber(it.loan.number),
        number: it.loan.number,
        status: it.loan.status,
        borrower: { id: it.loan.borrower.id, name: it.loan.borrower.name },
        quantity: it.quantity,
        outstanding: itemOutstanding(it.loan.status, it),
        dueDate,
        isOverdue: overdueInfo(dueDate, true, today).isOverdue,
      };
    })
    .filter((l) => l.outstanding > 0)
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.number - b.number)
    .map(({ number: _n, ...rest }) => rest);
  return { ...serializeBook(book), currentLoans };
}

// ------------------------------------------------------------------ create

function bookData(input: BookInput) {
  const total = input.totalCopies ?? 1;
  return {
    title: input.title,
    author: input.author ?? null,
    isbn: input.isbn ?? null,
    publisher: input.publisher ?? null,
    publicationYear: input.publicationYear ?? null,
    callNumber: input.callNumber ?? null,
    totalCopies: total,
    availableCopies: total,
    notes: input.notes ?? null,
  };
}

/**
 * 404 unless the library exists. FOR KEY SHARE: a concurrent library delete waits until the calling
 * transaction has inserted its books (and then fails with LIBRARY_NOT_EMPTY) instead of racing it.
 */
async function assertLibrary(db: Db, libraryId: string) {
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Library" WHERE "id" = ${libraryId} FOR KEY SHARE`;
  if (rows.length === 0) throw notFound("Library");
}

export async function createBook(input: BookInput & { libraryId: string }) {
  const id = await prisma.$transaction(async (tx) => {
    await assertLibrary(tx, input.libraryId);
    const category = await resolveCategory(tx, input.libraryId, input);
    const b = await tx.book.create({
      data: { ...bookData(input), libraryId: input.libraryId, categoryId: category.id ?? null },
      select: { id: true },
    });
    return b.id;
  }, TX_OPTIONS);
  return serializeBook(await getBookRow(prisma, id));
}

/** All-or-nothing bulk insert; categories given by name are matched case-insensitively or created. */
export async function bulkCreateBooks(libraryId: string, books: BookInput[]) {
  return prisma.$transaction(async (tx) => {
    await assertLibrary(tx, libraryId);
    const categoriesCreated: string[] = [];
    const byName = new Map<string, string | null>(); // lower-cased name → id
    const rows: Prisma.BookCreateManyInput[] = [];
    for (const input of books) {
      let categoryId: string | null = null;
      if (input.categoryId !== undefined) {
        categoryId = (await resolveCategory(tx, libraryId, { categoryId: input.categoryId })).id ?? null;
      } else if (input.categoryName) {
        const key = input.categoryName.toLowerCase();
        if (!byName.has(key)) {
          const res = await resolveCategory(tx, libraryId, { categoryName: input.categoryName });
          byName.set(key, res.id ?? null);
          if (res.created) categoriesCreated.push(res.created);
        }
        categoryId = byName.get(key) ?? null;
      }
      rows.push({ ...bookData(input), libraryId, categoryId });
    }
    const res = await tx.book.createMany({ data: rows });
    return { created: res.count, categoriesCreated };
  }, TX_OPTIONS);
}

// ------------------------------------------------------------------ update / delete

async function changeTotalCopies(tx: Tx, id: string, newTotal: number) {
  // Atomic relative to the row's current values: available += (new - old), refused if it would go below 0.
  const changed = await tx.$executeRaw`
    UPDATE "Book"
       SET "availableCopies" = "availableCopies" + (${newTotal}::int - "totalCopies"),
           "totalCopies" = ${newTotal}::int,
           "updatedAt" = NOW()
     WHERE "id" = ${id}
       AND "availableCopies" + (${newTotal}::int - "totalCopies") >= 0`;
  if (changed !== 1) {
    const b = await tx.book.findUnique({ where: { id }, select: { totalCopies: true, availableCopies: true } });
    if (!b) throw notFound("Book");
    const onLoan = b.totalCopies - b.availableCopies;
    throw new HttpError(
      409,
      "COPIES_IN_USE",
      `${onLoan} ${onLoan === 1 ? "copy is" : "copies are"} currently borrowed, so the total cannot be less than ${onLoan}.`,
    );
  }
}

export async function updateBook(id: string, input: BookPatchInput) {
  await prisma.$transaction(async (tx) => {
    const book = await tx.book.findUnique({ where: { id }, select: { libraryId: true } });
    if (!book) throw notFound("Book");
    const category = await resolveCategory(tx, book.libraryId, input);
    await tx.book.update({
      where: { id },
      data: {
        title: input.title,
        author: input.author,
        isbn: input.isbn,
        publisher: input.publisher,
        publicationYear: input.publicationYear,
        callNumber: input.callNumber,
        notes: input.notes,
        archived: input.archived,
        ...(category.id !== undefined ? { category: category.id ? { connect: { id: category.id } } : { disconnect: true } } : {}),
      },
    });
    if (input.totalCopies !== undefined) await changeTotalCopies(tx, id, input.totalCopies);
  }, TX_OPTIONS);
  return serializeBook(await getBookRow(prisma, id));
}

// ------------------------------------------------------------------ picture

export const MAX_COVER_BYTES = 1024 * 1024; // 1 MB decoded

/** First bytes each accepted type must start with (null = any byte). */
const MAGIC: Record<string, (number | null)[]> = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  // "RIFF" <4-byte size> "WEBP"
  "image/webp": [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50],
};

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*={0,2})$/;

const invalidImage = () =>
  new HttpError(400, "INVALID_IMAGE", "This file is not a picture we can use. Please choose a photo (JPEG, PNG or WebP).");

/**
 * Decodes a `data:image/jpeg|png|webp;base64,…` URL. Strict: canonical base64 only (Node's decoder silently skips
 * bad characters), at most 1 MB decoded, and the first bytes must match the stated type.
 */
export function parseImageDataUrl(image: string): { mimeType: string; data: Buffer } {
  const m = DATA_URL.exec(image);
  if (!m) throw invalidImage();
  const [, mimeType, base64] = m;
  if (base64.length % 4 !== 0) throw invalidImage();
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  if ((base64.length / 4) * 3 - padding > MAX_COVER_BYTES) {
    throw new HttpError(413, "IMAGE_TOO_LARGE", "This picture is too big (more than 1 MB). Please choose a smaller one.");
  }
  const data = Buffer.from(base64, "base64");
  if (data.toString("base64") !== base64) throw invalidImage();
  const magic = MAGIC[mimeType];
  if (data.length < magic.length || magic.some((b, i) => b !== null && data[i] !== b)) throw invalidImage();
  return { mimeType, data };
}

/** Sets or replaces the book's picture; returns the Book (with its new coverUrl). */
export async function setBookCover(id: string, image: string) {
  const { mimeType, data } = parseImageDataUrl(image);
  const book = await prisma.book.findUnique({ where: { id }, select: { id: true } });
  if (!book) throw notFound("Book");
  const bytes = new Uint8Array(data);
  try {
    await prisma.bookCover.upsert({
      where: { bookId: id },
      create: { bookId: id, mimeType, data: bytes },
      update: { mimeType, data: bytes },
    });
  } catch (err) {
    if (isForeignKeyViolation(err)) throw notFound("Book"); // the book was deleted meanwhile
    throw err;
  }
  return serializeBook(await getBookRow(prisma, id));
}

/** Removes the book's picture (fine when it has none); returns the Book. */
export async function removeBookCover(id: string) {
  await prisma.bookCover.deleteMany({ where: { bookId: id } });
  return serializeBook(await getBookRow(prisma, id));
}

export async function getBookCover(id: string) {
  const cover = await prisma.bookCover.findUnique({ where: { bookId: id }, select: { mimeType: true, data: true } });
  if (cover) return cover;
  const book = await prisma.book.findUnique({ where: { id }, select: { id: true } });
  throw notFound(book ? "Picture" : "Book");
}

export async function deleteBook(id: string) {
  const b = await prisma.book.findUnique({ where: { id }, select: { _count: { select: { loanItems: true } } } });
  if (!b) throw notFound("Book");
  const hasLoans = () =>
    new HttpError(409, "BOOK_HAS_LOANS", "This book appears in borrowing history and cannot be deleted. Archive it instead.");
  if (b._count.loanItems > 0) throw hasLoans();
  try {
    await prisma.book.delete({ where: { id } });
  } catch (err) {
    if (isForeignKeyViolation(err)) throw hasLoans();
    throw err;
  }
}
