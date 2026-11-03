import { prisma, type Db } from "../lib/prisma.js";
import { HttpError, notFound } from "../lib/http-error.js";
import { isUniqueViolation } from "../lib/prisma-errors.js";

export type CategoryInput = { name: string; description?: string | null };

const categoryExists = () => new HttpError(409, "CATEGORY_EXISTS", "This library already has a grouping with that name.");

type CategoryRow = { id: string; libraryId: string; name: string; description: string | null };
const serializeCategory = (c: CategoryRow, bookCount: number) => ({
  id: c.id,
  libraryId: c.libraryId,
  name: c.name,
  description: c.description,
  bookCount,
});

async function bookCounts(categoryIds: string[]) {
  const rows = await prisma.book.groupBy({
    by: ["categoryId"],
    where: { categoryId: { in: categoryIds }, archived: false },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.categoryId, r._count._all]));
}

/** Case-insensitive lookup of a category name within a library. */
export function findCategoryByName(db: Db, libraryId: string, name: string, excludeId?: string) {
  return db.category.findFirst({
    where: { libraryId, name: { equals: name, mode: "insensitive" }, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
}

export async function listCategories(libraryId: string) {
  const lib = await prisma.library.findUnique({ where: { id: libraryId }, select: { id: true } });
  if (!lib) throw notFound("Library");
  const rows = await prisma.category.findMany({ where: { libraryId }, orderBy: [{ name: "asc" }, { id: "asc" }] });
  const counts = await bookCounts(rows.map((r) => r.id));
  return { data: rows.map((c) => serializeCategory(c, counts.get(c.id) ?? 0)) };
}

async function getCategory(id: string) {
  const c = await prisma.category.findUnique({ where: { id } });
  if (!c) throw notFound("Category");
  const counts = await bookCounts([id]);
  return serializeCategory(c, counts.get(id) ?? 0);
}

export async function createCategory(libraryId: string, input: CategoryInput) {
  const lib = await prisma.library.findUnique({ where: { id: libraryId }, select: { id: true } });
  if (!lib) throw notFound("Library");
  if (await findCategoryByName(prisma, libraryId, input.name)) throw categoryExists();
  try {
    const c = await prisma.category.create({
      data: { libraryId, name: input.name, description: input.description ?? null },
    });
    return serializeCategory(c, 0);
  } catch (err) {
    if (isUniqueViolation(err)) throw categoryExists();
    throw err;
  }
}

export async function updateCategory(id: string, input: Partial<CategoryInput>) {
  const c = await prisma.category.findUnique({ where: { id } });
  if (!c) throw notFound("Category");
  if (input.name !== undefined && (await findCategoryByName(prisma, c.libraryId, input.name, id))) throw categoryExists();
  try {
    await prisma.category.update({ where: { id }, data: { name: input.name, description: input.description } });
  } catch (err) {
    if (isUniqueViolation(err)) throw categoryExists();
    throw err;
  }
  return getCategory(id);
}

export async function deleteCategory(id: string) {
  const c = await prisma.category.findUnique({ where: { id }, select: { id: true } });
  if (!c) throw notFound("Category");
  await prisma.category.delete({ where: { id } }); // books: categoryId → null (onDelete: SetNull)
}
