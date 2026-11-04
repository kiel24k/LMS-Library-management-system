/**
 * The signed-in account's own things (behind `requireAuth`). "My Books": the borrow records of the borrower linked
 * to the account (User.borrowerId). Everything is scoped to that borrower; nothing here ever returns another
 * borrower's data or staff names.
 */
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { todayDateOnly } from "../lib/dates.js";
import { HttpError } from "../lib/http-error.js";
import { formatLoanNumber } from "../lib/loan-number.js";
import { id, intIn, optStr } from "../lib/validation.js";
import { currentUser, requirePermission } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { createAccountRequest } from "../services/loan.service.js";
import { portalLoanInclude, serializePortalLoan } from "../services/serializers.js";
import { enabledLibrary } from "./public.routes.js";

/** Same item rules as the public form; no borrower details (the account's linked borrower is used). */
const requestSchema = z.object({
  slug: z.string({ error: "Required." }).trim().min(1, "Required.").max(60),
  items: z
    .array(z.object({ bookId: id(), quantity: intIn(1, 5) }), { error: "Required." })
    .min(1, "Add at least one book.")
    .max(20, "At most 20 different books per request."),
  notes: optStr(500),
});

export function meRouter(limiters: { request: RequestHandler }) {
  const r = Router();

  // Every borrow record of the linked borrower (all statuses), newest first. Not linked → borrower null, no records.
  r.get("/loans", requirePermission("my_books.view"), async (req, res) => {
    const { borrower } = currentUser(req);
    if (!borrower) {
      res.json({ borrower: null, data: [] });
      return;
    }
    const today = todayDateOnly();
    const rows = await prisma.loan.findMany({
      where: { borrowerId: borrower.id },
      include: portalLoanInclude,
      orderBy: [{ requestedAt: "desc" }, { number: "desc" }],
    });
    res.json({ borrower: { id: borrower.id, name: borrower.name }, data: rows.map((l) => serializePortalLoan(l, today)) });
  });

  // "Borrow more books" while signed in: a request for the linked borrower, from a library whose public form is on
  // (unknown slug or disabled form → the same 404 as the public endpoints). Not linked → 409 NOT_LINKED.
  r.post("/requests", limiters.request, requirePermission("my_books.view"), validateBody(requestSchema), async (req, res) => {
    const { borrower } = currentUser(req);
    if (!borrower) {
      throw new HttpError(409, "NOT_LINKED", "This account isn't linked to a borrower, so it can't send requests for itself.");
    }
    const body = req.body as z.output<typeof requestSchema>;
    const library = await enabledLibrary(body.slug);
    const loan = await createAccountRequest(library.id, borrower.id, { items: body.items, notes: body.notes });
    res.status(201).json({ loanNumber: formatLoanNumber(loan.number), status: loan.status, email: loan.email });
  });

  return r;
}
