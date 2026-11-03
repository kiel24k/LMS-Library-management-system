import { Router } from "express";
import { z } from "zod";
import { validateBody } from "../middleware/validate.js";
import { currentUser, requireAdmin, setAuthCookie } from "../middleware/auth.js";
import { newPassword, reqStr, param } from "../lib/validation.js";
import * as users from "../services/user.service.js";

const email = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
  // Local addresses like admin@localhost are allowed, so only check the basic name@host shape.
  z.string({ error: "Required." }).regex(/^[^\s@]+@[^\s@]+$/, "Enter a valid email address.").max(254),
);
const password = newPassword();
const role = z.enum(["ADMIN", "STAFF"], { error: 'Must be "ADMIN" or "STAFF".' });

const userCreate = z.object({ email, name: reqStr(1, 120), password, role: role.default("STAFF") });
const userPatch = z.object({ name: reqStr(1, 120).optional(), role: role.optional(), active: z.boolean().optional(), password: password.optional() });

export function userRouter() {
  const r = Router();
  r.use(requireAdmin);
  r.get("/", async (_req, res) => {
    res.json(await users.listUsers());
  });
  r.post("/", validateBody(userCreate), async (req, res) => {
    res.status(201).json(await users.createUser(req.body as z.output<typeof userCreate>));
  });
  r.patch("/:id", validateBody(userPatch), async (req, res) => {
    const body = req.body as z.output<typeof userPatch>;
    const id = param(req, "id");
    const { user, tokenVersion } = await users.updateUser(id, body, currentUser(req).id);
    // Resetting your own password signs out your other sessions but keeps this one.
    if (id === currentUser(req).id && body.password !== undefined) setAuthCookie(res, { id, tokenVersion });
    res.json(user);
  });
  return r;
}
