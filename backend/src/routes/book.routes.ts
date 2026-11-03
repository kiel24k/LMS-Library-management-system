import { Router } from "express";
import { z } from "zod";
import { getQuery, validateBody, validateQuery } from "../middleware/validate.js";
import { id, intIn, optInt, optStr, pagination, queryBool, queryStr, reqStr, param } from "../lib/validation.js";
import * as books from "../services/book.service.js";

const bookFields = {
  title: reqStr(1, 300),
  author: optStr(200),
  isbn: optStr(40),
  publisher: optStr(200),
  publicationYear: optInt(1000, 9999),
  callNumber: optStr(100),
  totalCopies: intIn(1, 10000).optional(),
  categoryId: z.preprocess((v) => (v === "" ? null : v), z.string().min(1).max(64).nullable().optional()),
  categoryName: optStr(80),
  notes: optStr(1000),
};

const oneCategoryField = (v: { categoryId?: unknown; categoryName?: unknown }) =>
  !(v.categoryId !== undefined && v.categoryName !== undefined);
const oneCategoryIssue = { message: "Send either categoryId or categoryName, not both.", path: ["categoryName"] };

export const bookInput = z.object(bookFields).refine(oneCategoryField, oneCategoryIssue);
const bookCreate = z.object({ ...bookFields, libraryId: id() }).refine(oneCategoryField, oneCategoryIssue);
const bookBulk = z.object({
  libraryId: id(),
  books: z.array(bookInput, { error: "Required." }).min(1, "Add at least one book.").max(500, "At most 500 books per import."),
});
const bookPatch = z
  .object({ ...bookFields, totalCopies: intIn(0, 10000).optional(), archived: z.boolean().optional() })
  .partial()
  .refine(oneCategoryField, oneCategoryIssue);

// A data URL of at most 1 MB is ~1.4 MB of base64; the JSON body limit for this route is 2mb (see app.ts).
// Larger pictures that still fit the body get 413 IMAGE_TOO_LARGE from the service.
const coverBody = z.object({
  image: z.string({ error: "Required." }).min(1, "Required.").max(2 * 1024 * 1024, "This picture is too big."),
});

const listQuery = z.object({
  libraryId: queryStr(64),
  categoryId: queryStr(64),
  q: queryStr(200),
  available: queryBool(),
  includeArchived: queryBool(),
  ...pagination(100),
});

export function bookRouter() {
  const r = Router();

  r.get("/", validateQuery(listQuery), async (_req, res) => {
    res.json(await books.listBooks(getQuery<typeof listQuery>(res)));
  });
  r.post("/", validateBody(bookCreate), async (req, res) => {
    res.status(201).json(await books.createBook(req.body as z.output<typeof bookCreate>));
  });
  r.post("/bulk", validateBody(bookBulk), async (req, res) => {
    const body = req.body as z.output<typeof bookBulk>;
    res.status(201).json(await books.bulkCreateBooks(body.libraryId, body.books));
  });
  r.get("/:id", async (req, res) => {
    res.json(await books.getBookDetail(param(req, "id")));
  });
  r.patch("/:id", validateBody(bookPatch), async (req, res) => {
    res.json(await books.updateBook(param(req, "id"), req.body as z.output<typeof bookPatch>));
  });
  r.delete("/:id", async (req, res) => {
    await books.deleteBook(param(req, "id"));
    res.status(204).end();
  });

  // Picture (staff-only). Its URL carries ?v=<updatedAt>, so the bytes behind one URL never change.
  r.get("/:id/cover", async (req, res) => {
    const cover = await books.getBookCover(param(req, "id"));
    res.set("Content-Type", cover.mimeType);
    res.set("Cache-Control", "private, max-age=31536000, immutable");
    res.send(Buffer.from(cover.data.buffer, cover.data.byteOffset, cover.data.byteLength));
  });
  r.put("/:id/cover", validateBody(coverBody), async (req, res) => {
    res.json(await books.setBookCover(param(req, "id"), (req.body as z.output<typeof coverBody>).image));
  });
  r.delete("/:id/cover", async (req, res) => {
    res.json(await books.removeBookCover(param(req, "id")));
  });

  return r;
}
