import { Router } from "express";
import { z } from "zod";
import { validateBody } from "../middleware/validate.js";
import { currentUser, requirePermission } from "../middleware/auth.js";
import { optStr, reqStr, param } from "../lib/validation.js";
import { isPermission, permissionCatalog, type Permission } from "../lib/permissions.js";
import * as roles from "../services/role.service.js";

const permissions = z
  .array(
    z.string({ error: "Must be a permission key." }).refine((p): p is Permission => isPermission(p), "Unknown permission."),
    { error: "Required." },
  )
  .max(200);

/** Only `true`: a role stops being the default when another role becomes it. */
const isDefault = z
  .boolean({ error: "Must be true or false." })
  .refine((v): v is true => v, "Choose another role as the default instead.")
  .optional();

const roleCreate = z.object({ name: reqStr(1, 60), description: optStr(200), permissions, isDefault });
const rolePatch = roleCreate.partial();

const actorOf = (req: Parameters<typeof currentUser>[0]) => {
  const me = currentUser(req);
  return { id: me.id, permissions: me.permissions };
};

/** GET /permissions: the catalog (modules → permissions) for any signed-in user, to render the permission tree. */
export function permissionRouter() {
  const r = Router();
  r.get("/", (_req, res) => {
    res.json({ data: permissionCatalog() });
  });
  return r;
}

export function roleRouter() {
  const r = Router();
  r.get("/", requirePermission("roles.view"), async (_req, res) => {
    res.json(await roles.listRoles());
  });
  r.post("/", requirePermission("roles.create"), validateBody(roleCreate), async (req, res) => {
    const body = req.body as z.output<typeof roleCreate>;
    res.status(201).json(await roles.createRole({ ...body, permissions: body.permissions as Permission[] }, actorOf(req)));
  });
  r.get("/:id", requirePermission("roles.view"), async (req, res) => {
    res.json(await roles.getRole(param(req, "id")));
  });
  r.patch("/:id", requirePermission("roles.update"), validateBody(rolePatch), async (req, res) => {
    const body = req.body as z.output<typeof rolePatch>;
    res.json(await roles.updateRole(param(req, "id"), { ...body, permissions: body.permissions as Permission[] | undefined }, actorOf(req)));
  });
  r.delete("/:id", requirePermission("roles.delete"), async (req, res) => {
    await roles.deleteRole(param(req, "id"));
    res.status(204).end();
  });
  return r;
}
