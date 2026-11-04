import { Router } from "express";
import { z } from "zod";
import { validateBody } from "../middleware/validate.js";
import { currentUser, requireAnyPermission, requirePermission, setAuthCookie } from "../middleware/auth.js";
import { id, newPassword, reqStr, param } from "../lib/validation.js";
import * as users from "../services/user.service.js";

const email = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
  // Local addresses like admin@localhost are allowed, so only check the basic name@host shape.
  z.string({ error: "Required." }).regex(/^[^\s@]+@[^\s@]+$/, "Enter a valid email address.").max(254),
);
const password = newPassword();

// No roleId: the account gets the default role (Role.isDefault).
const userCreate = z.object({ email, name: reqStr(1, 120), password, roleId: id().optional() });
const userPatch = z.object({ name: reqStr(1, 120).optional(), roleId: id().optional(), active: z.boolean().optional(), password: password.optional() });

const actorOf = (req: Parameters<typeof currentUser>[0]) => {
  const me = currentUser(req);
  return { id: me.id, roleId: me.role.id, permissions: me.permissions };
};

export function userRouter() {
  const r = Router();
  r.get("/", requirePermission("users.view"), async (_req, res) => {
    res.json(await users.listUsers());
  });
  r.post("/", requirePermission("users.create"), validateBody(userCreate), async (req, res) => {
    res.status(201).json(await users.createUser(req.body as z.output<typeof userCreate>, actorOf(req)));
  });
  // Each field has its own permission (checked in the service): name/roleId users.update, active
  // users.deactivate, password users.reset_password.
  r.patch(
    "/:id",
    requireAnyPermission("users.update", "users.deactivate", "users.reset_password"),
    validateBody(userPatch),
    async (req, res) => {
      const body = req.body as z.output<typeof userPatch>;
      const id = param(req, "id");
      const { user, tokenVersion } = await users.updateUser(id, body, actorOf(req));
      // Resetting your own password signs out your other sessions but keeps this one.
      if (id === currentUser(req).id && body.password !== undefined) setAuthCookie(res, { id, tokenVersion });
      res.json(user);
    },
  );
  return r;
}
