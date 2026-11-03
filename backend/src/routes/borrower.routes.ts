import { Router } from "express";
import { z } from "zod";
import { getQuery, validateBody, validateQuery } from "../middleware/validate.js";
import { optStr, pagination, queryStr, reqStr, param } from "../lib/validation.js";
import * as borrowers from "../services/borrower.service.js";

export const borrowerInput = z.object({
  name: reqStr(2, 120),
  idNumber: optStr(50),
  contact: optStr(120),
  affiliation: optStr(120),
});
const borrowerPatch = borrowerInput.partial();
const listQuery = z.object({ q: queryStr(200), ...pagination(100) });

export function borrowerRouter() {
  const r = Router();
  r.get("/", validateQuery(listQuery), async (_req, res) => {
    res.json(await borrowers.listBorrowers(getQuery<typeof listQuery>(res)));
  });
  r.post("/", validateBody(borrowerInput), async (req, res) => {
    res.status(201).json(await borrowers.createBorrower(req.body as z.output<typeof borrowerInput>));
  });
  r.get("/:id", async (req, res) => {
    res.json(await borrowers.getBorrowerDetail(param(req, "id")));
  });
  r.patch("/:id", validateBody(borrowerPatch), async (req, res) => {
    res.json(await borrowers.updateBorrower(param(req, "id"), req.body as z.output<typeof borrowerPatch>));
  });
  r.delete("/:id", async (req, res) => {
    await borrowers.deleteBorrower(param(req, "id"));
    res.status(204).end();
  });
  return r;
}
