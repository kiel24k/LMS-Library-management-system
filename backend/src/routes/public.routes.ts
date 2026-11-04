/**
 * Public (no login) endpoints for a library's catalog and borrow form. Only available while the library's
 * public form is enabled; unknown slug and disabled form give the same 404. Never returns borrower data.
 */
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { HttpError, notFound } from "../lib/http-error.js";
import { getQuery, validateBody, validateQuery } from "../middleware/validate.js";
import { id, intIn, optStr, pagination, publicEmail, queryBool, queryStr, reqStr, skipTake, param } from "../lib/validation.js";
import { imageHeaders, toBuffer } from "../lib/images.js";
import { formatLoanNumber, parseLoanNumber } from "../lib/loan-number.js";
import { dateToDateOnly } from "../lib/dates.js";
import { createPublicRequest } from "../services/loan.service.js";

const requestSchema = z.object({
  borrower: z.object(
    // The email is required: the accept/reject email goes there, and it becomes the borrower's sign-in name.
    { name: reqStr(2, 120), email: publicEmail(), idNumber: optStr(50), contact: optStr(120), affiliation: optStr(120) },
    { error: "Required." },
  ),
  items: z
    .array(z.object({ bookId: id(), quantity: intIn(1, 5) }), { error: "Required." })
    .min(1, "Add at least one book.")
    .max(20, "At most 20 different books per request."),
  notes: optStr(500),
  // Honeypot: real users never fill it (the form renders it visually hidden).
  website: z.union([z.string().max(0, "Invalid request."), z.null()]).optional(),
});

const booksQuery = z.object({ q: queryStr(200), categoryId: queryStr(64), available: queryBool(), ...pagination(50) });
const statusQuery = z.object({ slug: z.string({ error: "Required." }).trim().min(1, "Required.").max(60) });

const publicLibrarySelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  location: true,
  defaultLoanDays: true,
} as const;

/** The library for `slug` if its public form is enabled; otherwise 404 (same response either way). */
export async function enabledLibrary(slug: string) {
  const library = await prisma.library.findFirst({
    where: { slug: slug.toLowerCase(), publicFormEnabled: true },
    select: publicLibrarySelect,
  });
  if (!library) throw notFound("Borrow form");
  return library;
}

/** ?v= changes with every new picture, so each URL can be cached for good. */
const publicCoverUrl = (slug: string, bookId: string, updatedAt: Date) =>
  `/api/public/libraries/${encodeURIComponent(slug)}/books/${encodeURIComponent(bookId)}/cover?v=${updatedAt.getTime()}`;

export function publicRouter(limiters: { request: RequestHandler[]; status: RequestHandler }) {
  const r = Router();

  // Libraries with a public form (the catalog's starting point), by name.
  r.get("/libraries", async (_req, res) => {
    const rows = await prisma.library.findMany({
      where: { publicFormEnabled: true },
      select: publicLibrarySelect,
      orderBy: [{ name: "asc" }, { slug: "asc" }],
    });
    res.json({ data: rows.map(({ id: _id, ...library }) => library) });
  });

  r.get("/libraries/:slug", async (req, res) => {
    const library = await enabledLibrary(param(req, "slug"));
    const categories = await prisma.category.findMany({
      where: { libraryId: library.id },
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    const { id: _id, ...publicLibrary } = library;
    res.json({ library: publicLibrary, categories });
  });

  r.get("/libraries/:slug/books", validateQuery(booksQuery), async (req, res) => {
    const library = await enabledLibrary(param(req, "slug"));
    const query = getQuery<typeof booksQuery>(res);
    const and: Prisma.BookWhereInput[] = [{ libraryId: library.id, archived: false }];
    if (query.categoryId) and.push({ categoryId: query.categoryId });
    if (query.available === true) and.push({ availableCopies: { gt: 0 } });
    if (query.available === false) and.push({ availableCopies: { lte: 0 } });
    if (query.q) {
      and.push({
        OR: (["title", "author", "isbn", "callNumber"] as const).map((f) => ({ [f]: { contains: query.q, mode: "insensitive" } })),
      });
    }
    const where: Prisma.BookWhereInput = { AND: and };
    const [total, rows] = await Promise.all([
      prisma.book.count({ where }),
      prisma.book.findMany({
        where,
        orderBy: [{ title: "asc" }, { id: "asc" }],
        select: {
          id: true,
          title: true,
          author: true,
          callNumber: true,
          availableCopies: true,
          category: { select: { id: true, name: true } },
          cover: { select: { updatedAt: true } }, // never the bytes; the cover route below serves them
        },
        ...skipTake(query),
      }),
    ]);
    res.json({
      data: rows.map((b) => ({
        id: b.id,
        title: b.title,
        author: b.author,
        callNumber: b.callNumber,
        category: b.category ? { id: b.category.id, name: b.category.name } : null,
        available: b.availableCopies > 0,
        coverUrl: b.cover ? publicCoverUrl(library.slug, b.id, b.cover.updatedAt) : null,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    });
  });

  // A book's picture, only for non-archived books of a library whose public form is enabled.
  r.get("/libraries/:slug/books/:bookId/cover", async (req, res) => {
    const library = await enabledLibrary(param(req, "slug"));
    const cover = await prisma.bookCover.findFirst({
      where: { bookId: param(req, "bookId"), book: { libraryId: library.id, archived: false } },
      select: { mimeType: true, data: true },
    });
    if (!cover) throw notFound("Picture");
    res.set(imageHeaders(cover.mimeType, req.query.v !== undefined, "public"));
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    res.send(toBuffer(cover.data));
  });

  r.post("/libraries/:slug/requests", ...limiters.request, validateBody(requestSchema), async (req, res) => {
    const library = await enabledLibrary(param(req, "slug"));
    const body = req.body as z.output<typeof requestSchema>;
    const loan = await createPublicRequest(library.id, body);
    res.status(201).json({ loanNumber: formatLoanNumber(loan.number), status: loan.status });
  });

  r.get("/requests/:loanNumber", limiters.status, validateQuery(statusQuery), async (req, res) => {
    const { slug } = getQuery<typeof statusQuery>(res);
    const number = parseLoanNumber(param(req, "loanNumber"));
    if (number === null) throw notFound("Request");
    const library = await enabledLibrary(slug);
    const loan = await prisma.loan.findUnique({
      where: { number },
      select: { number: true, status: true, requestedAt: true, dueDate: true, libraryId: true },
    });
    if (!loan || loan.libraryId !== library.id) throw new HttpError(404, "NOT_FOUND", "Request not found.");
    res.json({
      loanNumber: formatLoanNumber(loan.number),
      status: loan.status,
      requestedAt: loan.requestedAt.toISOString(),
      dueDate: loan.dueDate ? dateToDateOnly(loan.dueDate) : null,
    });
  });

  return r;
}
