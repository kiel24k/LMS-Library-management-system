import { Router } from "express";
import { z } from "zod";
import { getQuery, validateBody, validateQuery } from "../middleware/validate.js";
import { currentUser } from "../middleware/auth.js";
import { dateOnly, id, intIn, optStr, pagination, queryBool, queryStr, reqStr, param } from "../lib/validation.js";
import { LoanStatus } from "../generated/prisma/enums.js";
import * as loans from "../services/loan.service.js";
import { borrowerInput } from "./borrower.routes.js";

const STATUSES = Object.values(LoanStatus) as [LoanStatus, ...LoanStatus[]];

const items = z
  .array(z.object({ bookId: id(), quantity: intIn(1, 100) }), { error: "Required." })
  .min(1, "Add at least one book.")
  .max(50, "At most 50 different books per borrow record.");

const staffLoan = z
  .object({
    libraryId: id(),
    borrowerId: id().optional(),
    borrower: borrowerInput.optional(),
    items,
    dueDate: dateOnly().optional(),
    notes: optStr(500),
  })
  .refine((v) => (v.borrowerId === undefined) !== (v.borrower === undefined), {
    message: "Choose an existing borrower or enter a new one (exactly one).",
    path: ["borrowerId"],
  });

const loanPatch = z.object({ items: items.optional(), notes: optStr(500), dueDate: dateOnly().optional() });
const approve = z.object({ dueDate: dateOnly().optional() });
const reject = z.object({ reason: reqStr(1, 500) });
const cancel = z.object({ reason: optStr(500) });

const count = z.number({ error: "Must be a number." }).int("Must be a whole number.").min(0, "Cannot be negative.").max(100000);
const returns = z.object({
  items: z.array(
    z.object({ loanItemId: id(), good: count.default(0), damaged: count.default(0), lost: count.default(0) }),
    { error: "Required." },
  ).max(100),
  returnedByName: optStr(120),
  notes: optStr(500),
});

const statusList = z.preprocess(
  (v) =>
    typeof v === "string"
      ? v
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean)
      : v,
  z.array(z.enum(STATUSES, { error: "Unknown status." })).optional(),
);

const listQuery = z.object({
  libraryId: queryStr(64),
  status: statusList,
  borrowerId: queryStr(64),
  bookId: queryStr(64),
  overdue: queryBool(),
  q: queryStr(200),
  ...pagination(100),
});

export function loanRouter() {
  const r = Router();

  r.get("/", validateQuery(listQuery), async (_req, res) => {
    res.json(await loans.listLoans(getQuery<typeof listQuery>(res)));
  });
  r.post("/", validateBody(staffLoan), async (req, res) => {
    res.status(201).json(await loans.createStaffLoan(req.body as z.output<typeof staffLoan>, currentUser(req).id));
  });
  r.get("/:id", async (req, res) => {
    res.json(await loans.getLoanDetail(param(req, "id")));
  });
  r.patch("/:id", validateBody(loanPatch), async (req, res) => {
    res.json(await loans.updateLoan(param(req, "id"), req.body as z.output<typeof loanPatch>));
  });
  r.post("/:id/approve", validateBody(approve), async (req, res) => {
    res.json(await loans.approveLoan(param(req, "id"), req.body as z.output<typeof approve>, currentUser(req).id));
  });
  r.post("/:id/reject", validateBody(reject), async (req, res) => {
    const { reason } = req.body as z.output<typeof reject>;
    res.json(await loans.rejectLoan(param(req, "id"), reason, currentUser(req).id));
  });
  r.post("/:id/cancel", validateBody(cancel), async (req, res) => {
    const { reason } = req.body as z.output<typeof cancel>;
    res.json(await loans.cancelLoan(param(req, "id"), reason, currentUser(req).id));
  });
  r.post("/:id/returns", validateBody(returns), async (req, res) => {
    res.json(await loans.recordReturn(param(req, "id"), req.body as z.output<typeof returns>, currentUser(req).id));
  });

  return r;
}
