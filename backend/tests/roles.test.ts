import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { prisma } from "../src/lib/prisma.js";
import { ALL_PERMISSIONS, DEFAULT_STAFF_PERMISSIONS, normalizePermissions, PERMISSION_MODULES, SEED_ADMIN_PERMISSIONS } from "../src/lib/permissions.js";
import { app, createRole, createUser, loginAs } from "./helpers.js";

describe("permission catalog", () => {
  it("GET /permissions lists every module and permission to any signed-in user", async () => {
    expect((await request(app).get("/api/permissions")).status).toBe(401);
    const { agent } = await loginAs([]);
    const res = await agent.get("/api/permissions");
    expect(res.status).toBe(200);
    expect(res.body.data.map((m: { key: string }) => m.key)).toEqual(PERMISSION_MODULES.map((m) => m.key));
    expect(res.body.data.flatMap((m: { permissions: { key: string }[] }) => m.permissions.map((p) => p.key))).toEqual([...ALL_PERMISSIONS]);
    const loans = res.body.data.find((m: { key: string }) => m.key === "loans");
    expect(loans.label).toBe("Borrow Records");
    expect(loans.permissions.find((p: { key: string }) => p.key === "loans.create")).toEqual({
      key: "loans.create",
      label: "Borrow books",
      description: 'Staff "Borrow Books" form',
      requires: ["loans.view", "books.view", "borrowers.view"],
    });
    expect(loans.permissions.find((p: { key: string }) => p.key === "loans.view").description).toBeNull();
  });

  it("normalizePermissions dedupes, adds requires transitively and sorts in catalog order", () => {
    expect(normalizePermissions(["users.create", "loans.create", "loans.create"])).toEqual([
      "books.view",
      "borrowers.view",
      "loans.view",
      "loans.create",
      "users.view",
      "users.create",
      "roles.view",
    ]);
    expect(normalizePermissions(["categories.delete"])).toEqual(["libraries.view", "categories.delete"]);
    expect(normalizePermissions([])).toEqual([]);
  });
});

describe("roles", () => {
  it("creates, lists (sorted by name, case-insensitive), reads, updates and deletes roles", async () => {
    const { agent, user } = await loginAs("all");
    const created = await agent.post("/api/roles").send({ name: "  librarian ", description: "Front desk", permissions: ["books.update", "loans.return"] });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      id: expect.any(String),
      name: "librarian",
      description: "Front desk",
      // requires added, catalog order
      permissions: ["books.view", "books.update", "loans.view", "loans.return"],
      userCount: 0,
      isDefault: false,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    await agent.post("/api/roles").send({ name: "Auditor", permissions: [] });

    const list = await agent.get("/api/roles");
    expect(list.status).toBe(200);
    const mine = await prisma.role.findUniqueOrThrow({ where: { id: user.roleId } });
    expect(list.body.data.map((r: { name: string }) => r.name)).toEqual(["Auditor", "librarian", mine.name]);
    expect(list.body.data.find((r: { id: string }) => r.id === user.roleId).userCount).toBe(1);

    const id = created.body.id as string;
    expect((await agent.get(`/api/roles/${id}`)).body.name).toBe("librarian");
    expect((await agent.get("/api/roles/missing")).status).toBe(404);

    const patched = await agent.patch(`/api/roles/${id}`).send({ name: "Librarian", description: "", permissions: ["borrowers.delete"] });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ name: "Librarian", description: null, permissions: ["borrowers.view", "borrowers.delete"] });
    const renameOnly = await agent.patch(`/api/roles/${id}`).send({ name: "Librarians" });
    expect(renameOnly.body.permissions).toEqual(["borrowers.view", "borrowers.delete"]);
    expect((await agent.patch("/api/roles/missing").send({ name: "X" })).status).toBe(404);

    expect((await agent.delete(`/api/roles/${id}`).send({})).status).toBe(204);
    expect((await agent.get(`/api/roles/${id}`)).status).toBe(404);
    expect((await agent.delete(`/api/roles/${id}`).send({})).status).toBe(404);
  });

  it("validates the body: unknown permission keys and bad names are rejected", async () => {
    const { agent } = await loginAs("all");
    const res = await agent.post("/api/roles").send({ name: "", permissions: ["books.view", "books.fly"] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["name"] }),
        { path: ["permissions", 1], message: "Unknown permission." },
      ]),
    );
    const missing = await agent.post("/api/roles").send({ name: "X" });
    expect(missing.body.error.details.issues.map((i: { path: string[] }) => i.path[0])).toEqual(["permissions"]);
    const long = await agent.post("/api/roles").send({ name: "x".repeat(61), description: "d".repeat(201), permissions: [] });
    expect(long.body.error.details.issues.map((i: { path: string[] }) => i.path[0]).sort()).toEqual(["description", "name"]);
    expect(await prisma.role.count({ where: { name: { not: { startsWith: "Role " } } } })).toBe(0);
  });

  it("role names are unique regardless of case (ROLE_NAME_TAKEN)", async () => {
    const { agent } = await loginAs("all");
    await createRole([], "Volunteers");
    const dup = await agent.post("/api/roles").send({ name: "VOLUNTEERS", permissions: [] });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("ROLE_NAME_TAKEN");
    const other = await createRole([], "Interns");
    const rename = await agent.patch(`/api/roles/${other.id}`).send({ name: "volunteers" });
    expect(rename.status).toBe(409);
    expect(rename.body.error.code).toBe("ROLE_NAME_TAKEN");
    // Changing only the case of its own name is fine.
    expect((await agent.patch(`/api/roles/${other.id}`).send({ name: "INTERNS" })).status).toBe(200);
    // The database enforces it too (two concurrent creates cannot both pass the check).
    await expect(prisma.role.create({ data: { name: "interns", permissions: [] } })).rejects.toThrow();
  });

  it("a role still given to an account (active or not) cannot be deleted (ROLE_IN_USE)", async () => {
    const { agent } = await loginAs("all");
    const role = await createRole([]);
    const user = await createUser({ roleId: role.id, active: false });
    const res = await agent.delete(`/api/roles/${role.id}`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ROLE_IN_USE");
    expect((await agent.get(`/api/roles/${role.id}`)).body.userCount).toBe(1);
    await prisma.user.delete({ where: { id: user.id } });
    expect((await agent.delete(`/api/roles/${role.id}`).send({})).status).toBe(204);
  });

  it("cannot grant permissions the actor does not have (PERMISSION_ESCALATION)", async () => {
    await createUser({ permissions: "all" });
    const { agent } = await loginAs(["roles.create", "roles.update", "books.update"]);
    const create = await agent.post("/api/roles").send({ name: "Bigger", permissions: ["books.delete"] });
    expect(create.status).toBe(403);
    expect(create.body.error.code).toBe("PERMISSION_ESCALATION");
    expect(await prisma.role.count({ where: { name: "Bigger" } })).toBe(0);
    // Requires are added before the check: users.create brings users.view + roles.view (the actor lacks users.*).
    const viaRequires = await agent.post("/api/roles").send({ name: "Bigger", permissions: ["users.create"] });
    expect(viaRequires.status).toBe(403);
    const ok = await agent.post("/api/roles").send({ name: "Smaller", permissions: ["books.update"] });
    expect(ok.status).toBe(201);

    // Updating: only *added* permissions must be held; ones the role already has may stay (or be removed).
    const role = await createRole(["dashboard.view", "books.view"], "Mixed");
    const keep = await agent.patch(`/api/roles/${role.id}`).send({ permissions: ["dashboard.view", "books.update"] });
    expect(keep.status).toBe(200);
    expect(keep.body.permissions).toEqual(["dashboard.view", "books.view", "books.update"]);
    const add = await agent.patch(`/api/roles/${role.id}`).send({ permissions: ["dashboard.view", "books.view", "loans.view"] });
    expect(add.status).toBe(403);
    expect(add.body.error.code).toBe("PERMISSION_ESCALATION");
    expect((await prisma.role.findUniqueOrThrow({ where: { id: role.id } })).permissions).toEqual(["dashboard.view", "books.view", "books.update"]);
  });

  it("removing access-admin permissions from the only role that has them is rejected (ACCESS_LOCKOUT)", async () => {
    const { agent, user } = await loginAs("all");
    const res = await agent.patch(`/api/roles/${user.roleId}`).send({ permissions: ["users.view", "users.update", "roles.view"] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ACCESS_LOCKOUT");
    expect((await prisma.role.findUniqueOrThrow({ where: { id: user.roleId } })).permissions).toEqual([...ALL_PERMISSIONS]);

    // Removing something else is fine.
    const ok = await agent.patch(`/api/roles/${user.roleId}`).send({ permissions: ALL_PERMISSIONS.filter((p) => p !== "books.delete") });
    expect(ok.status).toBe(200);

    // An inactive access admin does not count; an active one on another role does.
    await createUser({ permissions: "all", active: false });
    expect((await agent.patch(`/api/roles/${user.roleId}`).send({ permissions: [] })).status).toBe(409);
    await createUser({ permissions: "all" });
    const emptied = await agent.patch(`/api/roles/${user.roleId}`).send({ permissions: [] });
    expect(emptied.status).toBe(200);
    // ...and it applies to the actor at once.
    expect((await agent.get("/api/roles")).status).toBe(403);
    expect((await agent.get("/api/auth/me")).body.user.permissions).toEqual([]);
  });

  it("concurrent edits of two admin roles cannot both remove access (ACCESS_LOCKOUT)", async () => {
    const a = await loginAs("all");
    const b = await loginAs("all");
    const [r1, r2] = await Promise.all([
      a.agent.patch(`/api/roles/${b.user.roleId}`).send({ permissions: ["books.view"] }),
      b.agent.patch(`/api/roles/${a.user.roleId}`).send({ permissions: ["books.view"] }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    // The loser either hits the guard, or (if it ran second and its own role was emptied) lacks roles.update.
    expect(statuses[0]).toBe(200);
    expect([403, 409]).toContain(statuses[1]);
    const admins = await prisma.role.count({ where: { permissions: { hasEvery: ["users.view", "users.update", "roles.view", "roles.update"] } } });
    expect(admins).toBe(1);
  });
});

describe("default role for new accounts", () => {
  const defaults = () => prisma.role.findMany({ where: { isDefault: true }, select: { id: true } });

  it("PATCH isDefault: true moves the flag (exactly one default); GET /roles shows it", async () => {
    const { agent } = await loginAs("all");
    const a = await createRole([], "Alpha");
    const b = await createRole([], "Beta");
    const first = await agent.patch(`/api/roles/${a.id}`).send({ isDefault: true });
    expect(first.status).toBe(200);
    expect(first.body.isDefault).toBe(true);
    expect(await defaults()).toEqual([{ id: a.id }]);

    // Can be combined with other fields.
    const second = await agent.patch(`/api/roles/${b.id}`).send({ isDefault: true, name: "Bravo", permissions: ["books.view"] });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ name: "Bravo", isDefault: true, permissions: ["books.view"] });
    expect(await defaults()).toEqual([{ id: b.id }]);

    const list = await agent.get("/api/roles");
    expect(list.body.data.map((r: { name: string; isDefault: boolean }) => [r.name, r.isDefault])).toEqual(
      expect.arrayContaining([["Alpha", false], ["Bravo", true]]),
    );
    // Re-sending it for the current default changes nothing.
    expect((await agent.patch(`/api/roles/${b.id}`).send({ isDefault: true })).status).toBe(200);
    expect(await defaults()).toEqual([{ id: b.id }]);
  });

  it("isDefault: false is rejected (choose another role instead)", async () => {
    const { agent } = await loginAs("all");
    const role = await createRole([], "Alpha");
    await prisma.role.update({ where: { id: role.id }, data: { isDefault: true } });
    const res = await agent.patch(`/api/roles/${role.id}`).send({ isDefault: false });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.issues).toEqual([{ path: ["isDefault"], message: "Choose another role as the default instead." }]);
    const create = await agent.post("/api/roles").send({ name: "New", permissions: [], isDefault: false });
    expect(create.status).toBe(400);
    expect(await defaults()).toEqual([{ id: role.id }]);
  });

  it("POST /roles with isDefault: true creates the new default", async () => {
    const { agent } = await loginAs("all");
    const old = await createRole([], "Old default");
    await prisma.role.update({ where: { id: old.id }, data: { isDefault: true } });
    const res = await agent.post("/api/roles").send({ name: "Newcomers", permissions: ["books.view"], isDefault: true });
    expect(res.status).toBe(201);
    expect(res.body.isDefault).toBe(true);
    expect(await defaults()).toEqual([{ id: res.body.id }]);
    const plain = await agent.post("/api/roles").send({ name: "Plain", permissions: [] });
    expect(plain.body.isDefault).toBe(false);
  });

  it("POST /roles with isDefault: true also needs roles.update (403 FORBIDDEN, default unchanged)", async () => {
    await createUser({ permissions: "all" });
    const old = await createRole([], "Old default");
    await prisma.role.update({ where: { id: old.id }, data: { isDefault: true } });
    const { agent } = await loginAs(["roles.view", "roles.create", "books.view"]);
    const res = await agent.post("/api/roles").send({ name: "Sneaky", permissions: ["books.view"], isDefault: true });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(await defaults()).toEqual([{ id: old.id }]);
    expect(await prisma.role.findFirst({ where: { name: "Sneaky" } })).toBeNull();
    // Without isDefault, roles.create alone is enough.
    expect((await agent.post("/api/roles").send({ name: "Plain", permissions: ["books.view"] })).status).toBe(201);
  });

  it("making a role the default needs every permission of it (PERMISSION_ESCALATION)", async () => {
    await createUser({ permissions: "all" });
    const { agent } = await loginAs(["roles.view", "roles.update", "books.view"]);
    const bigger = await createRole(["books.view", "books.update"], "Editors");
    const res = await agent.patch(`/api/roles/${bigger.id}`).send({ isDefault: true });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PERMISSION_ESCALATION");
    expect(res.body.error.message).toBe("You can't make a role the default if it has permissions you don't have.");
    expect(await defaults()).toEqual([]);
    // Removing what the actor lacks in the same request is fine (the role as it is after the change counts).
    const ok = await agent.patch(`/api/roles/${bigger.id}`).send({ isDefault: true, permissions: ["books.view"] });
    expect(ok.status).toBe(200);
    expect(await defaults()).toEqual([{ id: bigger.id }]);
  });

  it("the default role cannot be deleted (ROLE_IS_DEFAULT)", async () => {
    const { agent } = await loginAs("all");
    const role = await createRole([], "Alpha");
    await prisma.role.update({ where: { id: role.id }, data: { isDefault: true } });
    const res = await agent.delete(`/api/roles/${role.id}`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ROLE_IS_DEFAULT");
    expect(await prisma.role.count({ where: { id: role.id } })).toBe(1);
    const other = await createRole([], "Beta");
    expect((await agent.patch(`/api/roles/${other.id}`).send({ isDefault: true })).status).toBe(200);
    expect((await agent.delete(`/api/roles/${role.id}`).send({})).status).toBe(204);
  });

  it("concurrent set-default requests leave exactly one default", async () => {
    const { agent } = await loginAs("all");
    const roles = await Promise.all(["A", "B", "C", "D", "E"].map((n) => createRole([], `Role ${n}`)));
    const results = await Promise.all(roles.map((r) => agent.patch(`/api/roles/${r.id}`).send({ isDefault: true })));
    expect(results.map((r) => r.status)).toEqual(roles.map(() => 200));
    const now = await defaults();
    expect(now).toHaveLength(1);
    expect(roles.map((r) => r.id)).toContain(now[0].id);
    // The database enforces it too.
    const other = roles.find((r) => r.id !== now[0].id)!;
    await expect(prisma.role.update({ where: { id: other.id }, data: { isDefault: true } })).rejects.toThrow();
  });
});

describe("seed", () => {
  const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const runSeed = () => execSync("npx tsx prisma/seed.ts", { cwd: backendDir, env: process.env, stdio: "pipe" });

  it("always gives admin@localhost the Administrator role with every Users and Roles permission", async () => {
    // Someone stripped the Administrator role and moved/deactivated the admin account.
    const adminRole = await createRole(["books.view"], "Administrator");
    const other = await createRole([], "Nobody");
    await createUser({ email: "admin@localhost", roleId: other.id, active: false });
    runSeed();

    const role = await prisma.role.findUniqueOrThrow({ where: { id: adminRole.id } });
    expect(role.permissions).toEqual(normalizePermissions(["books.view", ...SEED_ADMIN_PERMISSIONS]));
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@localhost" } });
    expect(admin).toMatchObject({ roleId: adminRole.id, active: true });
    const staff = await prisma.role.findUniqueOrThrow({ where: { name: "Staff" } });
    expect(staff.permissions).toEqual([...DEFAULT_STAFF_PERMISSIONS]);
    const login = await request(app).post("/api/auth/login").send({ email: "admin@localhost", password: "password123" });
    expect(login.status).toBe(200);
    expect(login.body.user.role.name).toBe("Administrator");
    expect(login.body.user.permissions).toEqual(expect.arrayContaining([...SEED_ADMIN_PERMISSIONS]));

    // Idempotent; an existing Staff role is never overwritten.
    await prisma.role.update({ where: { id: staff.id }, data: { permissions: [] } });
    runSeed();
    expect(await prisma.role.count({ where: { name: { in: ["Administrator", "Staff"] } } })).toBe(2);
    expect((await prisma.role.findUniqueOrThrow({ where: { id: staff.id } })).permissions).toEqual([]);
    expect((await prisma.role.findUniqueOrThrow({ where: { id: adminRole.id } })).permissions).toEqual(role.permissions);
  });

  it("makes Staff the default role only when there is none (never Administrator, never overriding)", async () => {
    runSeed();
    const staff = await prisma.role.findUniqueOrThrow({ where: { name: "Staff" } });
    expect(staff.isDefault).toBe(true);
    expect((await prisma.role.findUniqueOrThrow({ where: { name: "Administrator" } })).isDefault).toBe(false);

    // An existing default is kept.
    const other = await createRole([], "Volunteers");
    await prisma.$transaction([
      prisma.role.update({ where: { id: staff.id }, data: { isDefault: false } }),
      prisma.role.update({ where: { id: other.id }, data: { isDefault: true } }),
    ]);
    runSeed();
    const now = await prisma.role.findMany({ where: { isDefault: true }, select: { id: true } });
    expect(now).toEqual([{ id: other.id }]);

    // No default at all → Staff again.
    await prisma.role.update({ where: { id: other.id }, data: { isDefault: false } });
    runSeed();
    expect((await prisma.role.findMany({ where: { isDefault: true }, select: { id: true } }))).toEqual([{ id: staff.id }]);
  });

  it("makes sure the company profile row exists and never changes an edited one", async () => {
    await prisma.companyProfile.deleteMany();
    runSeed();
    expect(await prisma.companyProfile.findUniqueOrThrow({ where: { id: 1 } })).toMatchObject({ name: "Library System", logoData: null });
    await prisma.companyProfile.update({ where: { id: 1 }, data: { name: "St. Luke Library", tagline: "Read more" } });
    runSeed();
    expect(await prisma.companyProfile.findUniqueOrThrow({ where: { id: 1 } })).toMatchObject({ name: "St. Luke Library", tagline: "Read more" });
  });

  it("on an empty database creates the Administrator role with every permission", async () => {
    runSeed();
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "Administrator" } });
    expect(role.permissions).toEqual([...ALL_PERMISSIONS]);
    const login = await request(app).post("/api/auth/login").send({ email: "admin@localhost", password: "password123" });
    expect(login.body.user.permissions).toEqual([...ALL_PERMISSIONS]);
  });
});
