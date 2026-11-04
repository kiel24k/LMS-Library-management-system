import { Router } from "express";
import { z } from "zod";
import { validateBody } from "../middleware/validate.js";
import { requirePermission } from "../middleware/auth.js";
import { intIn, optStr, reqStr, param } from "../lib/validation.js";
import { SLUG_RE } from "../lib/slug.js";
import * as libraries from "../services/library.service.js";
import * as categories from "../services/category.service.js";

const slug = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
  z.string().regex(SLUG_RE, "Use 3–60 characters: lowercase letters, numbers and hyphens."),
);

const libraryCreate = z.object({
  name: reqStr(1, 120),
  // An empty slug on create means "generate it from the name".
  slug: z.preprocess((v) => (v === "" || v === null ? undefined : v), slug.optional()),
  description: optStr(1000),
  location: optStr(200),
  publicFormEnabled: z.boolean().optional(),
  defaultLoanDays: intIn(1, 365).optional(),
});
const libraryPatch = libraryCreate.partial().extend({ slug: slug.optional() });

export const categoryCreate = z.object({ name: reqStr(1, 80), description: optStr(500) });
export const categoryPatch = categoryCreate.partial();

export function libraryRouter() {
  const r = Router();

  // Any signed-in user: reference data for the library switcher and pickers everywhere.
  r.get("/", async (_req, res) => {
    res.json(await libraries.listLibraries());
  });
  r.post("/", requirePermission("libraries.create"), validateBody(libraryCreate), async (req, res) => {
    res.status(201).json(await libraries.createLibrary(req.body as z.output<typeof libraryCreate>));
  });
  r.get("/:id", requirePermission("libraries.view"), async (req, res) => {
    res.json(await libraries.getLibrary(param(req, "id")));
  });
  r.patch("/:id", requirePermission("libraries.update"), validateBody(libraryPatch), async (req, res) => {
    res.json(await libraries.updateLibrary(param(req, "id"), req.body as z.output<typeof libraryPatch>));
  });
  r.delete("/:id", requirePermission("libraries.delete"), async (req, res) => {
    await libraries.deleteLibrary(param(req, "id"));
    res.status(204).end();
  });

  // Groupings (categories) of a library. Listing them is open to any signed-in user (book forms and filters).
  r.get("/:libraryId/categories", async (req, res) => {
    res.json(await categories.listCategories(param(req, "libraryId")));
  });
  r.post("/:libraryId/categories", requirePermission("categories.create"), validateBody(categoryCreate), async (req, res) => {
    res.status(201).json(await categories.createCategory(param(req, "libraryId"), req.body as z.output<typeof categoryCreate>));
  });

  return r;
}

export function categoryRouter() {
  const r = Router();
  r.patch("/:id", requirePermission("categories.update"), validateBody(categoryPatch), async (req, res) => {
    res.json(await categories.updateCategory(param(req, "id"), req.body as z.output<typeof categoryPatch>));
  });
  r.delete("/:id", requirePermission("categories.delete"), async (req, res) => {
    await categories.deleteCategory(param(req, "id"));
    res.status(204).end();
  });
  return r;
}
