import { describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../src/lib/prisma.js";
import { ACCESS_ADMIN_PERMISSIONS } from "../src/lib/permissions.js";
import { app, createRole, createUser, loginAs, PASSWORD } from "./helpers.js";

describe("users (accounts)", () => {
  it("creates, lists (sorted by name) and never returns password hashes", async () => {
    const { agent } = await loginAs("all");
    const role = await createRole("staff", "Front desk");
    const res = await agent.post("/api/users").send({ email: " New.Staff@Test.Local ", name: "Zed Staff", password: "Password123", roleId: role.id });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      email: "new.staff@test.local",
      name: "Zed Staff",
      role: { id: role.id, name: "Front desk" },
      active: true,
      mustChangePassword: false,
      borrower: null,
      createdAt: expect.any(String),
    });
    const dup = await agent.post("/api/users").send({ email: "NEW.STAFF@test.local", name: "Dup", password: "Password123", roleId: role.id });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("EMAIL_TAKEN");
    const bad = await agent.post("/api/users").send({ email: "not-an-email", name: "", password: "short" });
    expect(bad.status).toBe(400);
    // roleId is optional (missing → the default role).
    expect(bad.body.error.details.issues.map((i: { path: string[] }) => i.path[0]).sort()).toEqual(["email", "name", "password"]);
    const list = await agent.get("/api/users");
    expect(list.body.data.map((u: { name: string }) => u.name)).toEqual(["Admin 1", "Zed Staff"].sort());
    expect(list.body.data.find((u: { name: string }) => u.name === "Zed Staff").role).toEqual({ id: role.id, name: "Front desk" });
    expect(JSON.stringify(list.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
    const login = await request(app).post("/api/auth/login").send({ email: "new.staff@test.local", password: "Password123" });
    expect(login.status).toBe(200);
  });

  it("rejects an unknown roleId with a field error", async () => {
    const { agent } = await loginAs("all");
    const res = await agent.post("/api/users").send({ email: "x@test.local", name: "X", password: "Password123", roleId: "missing" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.issues).toEqual([{ path: ["roleId"], message: "Role not found." }]);
    const staff = await createUser();
    const patch = await agent.patch(`/api/users/${staff.id}`).send({ roleId: "missing" });
    expect(patch.status).toBe(400);
    expect(patch.body.error.details.issues[0].path).toEqual(["roleId"]);
  });

  it("accepts local addresses without a dot in the host (e.g. staff@localhost)", async () => {
    const { agent } = await loginAs("all");
    const role = await createRole("staff");
    const res = await agent.post("/api/users").send({ email: "Staff@LocalHost", name: "Local", password: "Password123", roleId: role.id });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe("staff@localhost");
    const login = await request(app).post("/api/auth/login").send({ email: "staff@localhost", password: "Password123" });
    expect(login.status).toBe(200);
  });

  it("updates name/role/active and resets passwords; email is immutable", async () => {
    const { agent } = await loginAs("all");
    const staff = await createUser();
    const other = await createRole(["books.view"], "Readers");
    const res = await agent.patch(`/api/users/${staff.id}`).send({ name: "Renamed", roleId: other.id, email: "changed@test.local" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Renamed", role: { id: other.id, name: "Readers" }, email: staff.email });
    const reset = await agent.patch(`/api/users/${staff.id}`).send({ password: "BrandNew123" });
    expect(reset.status).toBe(200);
    expect((await request(app).post("/api/auth/login").send({ email: staff.email, password: PASSWORD })).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ email: staff.email, password: "BrandNew123" })).status).toBe(200);
    const off = await agent.patch(`/api/users/${staff.id}`).send({ active: false });
    expect(off.body.active).toBe(false);
    expect((await request(app).post("/api/auth/login").send({ email: staff.email, password: "BrandNew123" })).status).toBe(401);
    expect((await agent.patch("/api/users/missing").send({ name: "X" })).status).toBe(404);
  });

  it("a password reset or deactivation ends the user's existing sessions", async () => {
    const { agent } = await loginAs("all");
    const staff = await loginAs("staff");
    expect((await staff.agent.get("/api/auth/me")).status).toBe(200);
    // Renaming does not sign anyone out.
    expect((await agent.patch(`/api/users/${staff.user.id}`).send({ name: "Renamed" })).status).toBe(200);
    expect((await staff.agent.get("/api/auth/me")).status).toBe(200);

    expect((await agent.patch(`/api/users/${staff.user.id}`).send({ password: "BrandNew123" })).status).toBe(200);
    expect((await staff.agent.get("/api/auth/me")).status).toBe(401);

    // Deactivating and re-activating does not bring an old session back.
    const again = request.agent(app);
    expect((await again.post("/api/auth/login").send({ email: staff.user.email, password: "BrandNew123" })).status).toBe(200);
    await agent.patch(`/api/users/${staff.user.id}`).send({ active: false });
    await agent.patch(`/api/users/${staff.user.id}`).send({ active: true });
    expect((await again.get("/api/auth/me")).status).toBe(401);
  });

  it("resetting your own password keeps your session; passwords over 72 bytes are rejected", async () => {
    const { agent, user } = await loginAs("all");
    const res = await agent.patch(`/api/users/${user.id}`).send({ password: "MyNewPass123" });
    expect(res.status).toBe(200);
    expect((await agent.get("/api/auth/me")).status).toBe(200);
    const long = await agent.post("/api/users").send({ email: "e@test.local", name: "E", password: "😀".repeat(19), roleId: user.roleId });
    expect(long.status).toBe(400); // 19 characters, 76 bytes
    expect(long.body.error.details.issues.map((i: { path: string[] }) => i.path[0])).toEqual(["password"]);
  });
});

describe("users: default role for new accounts", () => {
  const body = (email: string) => ({ email, name: "New", password: "Password123" });

  it("POST /users without roleId gives the account the default role", async () => {
    const { agent } = await loginAs("all");
    const role = await createRole("staff", "Front desk");
    await prisma.role.update({ where: { id: role.id }, data: { isDefault: true } });
    const res = await agent.post("/api/users").send(body("default@test.local"));
    expect(res.status).toBe(201);
    expect(res.body.role).toEqual({ id: role.id, name: "Front desk" });
    // An explicit roleId still wins.
    const other = await createRole([], "Nobody");
    const explicit = await agent.post("/api/users").send({ ...body("explicit@test.local"), roleId: other.id });
    expect(explicit.status).toBe(201);
    expect(explicit.body.role.id).toBe(other.id);
  });

  it("without roleId and no default role → 400 on roleId", async () => {
    const { agent } = await loginAs("all");
    expect(await prisma.role.count({ where: { isDefault: true } })).toBe(0);
    const res = await agent.post("/api/users").send(body("none@test.local"));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.issues).toEqual([{ path: ["roleId"], message: "Choose a role (no default role is set)." }]);
    expect(await prisma.user.count({ where: { email: "none@test.local" } })).toBe(0);
  });

  it("the default role must stay within the actor's permissions (PERMISSION_ESCALATION)", async () => {
    await createUser({ permissions: "all" });
    const { agent } = await loginAs(["users.view", "users.create", "roles.view", "books.view"]);
    const bigger = await createRole(["books.view", "books.update"], "Editors");
    await prisma.role.update({ where: { id: bigger.id }, data: { isDefault: true } });
    const res = await agent.post("/api/users").send(body("big@test.local"));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PERMISSION_ESCALATION");
    expect(await prisma.user.count({ where: { email: "big@test.local" } })).toBe(0);

    // A default role within the actor's permissions is fine.
    const smaller = await createRole(["books.view"], "Readers");
    await prisma.$transaction([
      prisma.role.update({ where: { id: bigger.id }, data: { isDefault: false } }),
      prisma.role.update({ where: { id: smaller.id }, data: { isDefault: true } }),
    ]);
    const ok = await agent.post("/api/users").send(body("small@test.local"));
    expect(ok.status).toBe(201);
    expect(ok.body.role.id).toBe(smaller.id);
  });
});

describe("users: per-field permissions on PATCH /users/:id", () => {
  const fields = {
    name: { body: { name: "Renamed" }, perm: "users.update" },
    active: { body: { active: false }, perm: "users.deactivate" },
    password: { body: { password: "BrandNew123" }, perm: "users.reset_password" },
  } as const;

  it("each field needs its own permission; one missing rejects the whole request", async () => {
    await createUser({ permissions: "all" }); // keeps the lock-out guard satisfied
    for (const [field, { body, perm }] of Object.entries(fields)) {
      // A role without permissions: the actor holds everything it has, so the account may be managed.
      const target = await createUser({ name: "Target", permissions: [] });
      const { agent } = await loginAs([perm]);
      const ok = await agent.patch(`/api/users/${target.id}`).send(body);
      expect(ok.status, field).toBe(200);

      // Holding only this permission, adding any other field → 403 and nothing changes.
      for (const [other, o] of Object.entries(fields)) {
        if (other === field) continue;
        const before = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
        const res = await agent.patch(`/api/users/${target.id}`).send({ ...body, ...o.body });
        expect(res.status, `${field}+${other}`).toBe(403);
        expect(res.body.error.code).toBe("FORBIDDEN");
        expect(await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).toEqual(before);
      }
    }
  });

  it("roleId needs users.update", async () => {
    await createUser({ permissions: "all" });
    const target = await createUser();
    const role = await createRole([]);
    const { agent } = await loginAs(["users.deactivate", "users.reset_password"]);
    const res = await agent.patch(`/api/users/${target.id}`).send({ roleId: role.id });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });
});

describe("users: safety rules", () => {
  it("nobody can deactivate themselves or change their own role (SELF_MODIFICATION)", async () => {
    const { agent, user } = await loginAs("all");
    await createUser({ permissions: "all" });
    const other = await createRole("all", "Other admins");
    for (const body of [{ active: false }, { roleId: other.id }]) {
      const res = await agent.patch(`/api/users/${user.id}`).send(body);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("SELF_MODIFICATION");
    }
    // Re-sending your current role and renaming yourself are fine.
    const rename = await agent.patch(`/api/users/${user.id}`).send({ name: "Still me", roleId: user.roleId });
    expect(rename.status).toBe(200);
  });

  it("cannot give an account a role with permissions the actor lacks (PERMISSION_ESCALATION)", async () => {
    await createUser({ permissions: "all" });
    const { agent } = await loginAs(["users.view", "users.create", "users.update", "roles.view", "books.view"]);
    const bigger = await createRole(["books.view", "books.update"], "Editors");
    const smaller = await createRole(["books.view"], "Readers");
    const create = await agent.post("/api/users").send({ email: "n@test.local", name: "N", password: "Password123", roleId: bigger.id });
    expect(create.status).toBe(403);
    expect(create.body.error.code).toBe("PERMISSION_ESCALATION");
    expect(await prisma.user.count({ where: { email: "n@test.local" } })).toBe(0);
    const created = await agent.post("/api/users").send({ email: "n@test.local", name: "N", password: "Password123", roleId: smaller.id });
    expect(created.status).toBe(201);

    const target = await createUser({ roleId: smaller.id });
    const patch = await agent.patch(`/api/users/${target.id}`).send({ roleId: bigger.id });
    expect(patch.status).toBe(403);
    expect(patch.body.error.code).toBe("PERMISSION_ESCALATION");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).roleId).toBe(smaller.id);
  });

  it("always keeps an active account that can manage users and roles, even under concurrent deactivations (ACCESS_LOCKOUT)", async () => {
    const a = await loginAs("all");
    const b = await loginAs("all");
    const [r1, r2] = await Promise.all([
      a.agent.patch(`/api/users/${b.user.id}`).send({ active: false }),
      b.agent.patch(`/api/users/${a.user.id}`).send({ active: false }),
    ]);
    const statuses = [r1.status, r2.status];
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    const loser = r1.status === 200 ? r2 : r1;
    expect([401, 409]).toContain(loser.status);
    if (loser.status === 409) expect(loser.body.error.code).toBe("ACCESS_LOCKOUT");
    expect(await prisma.user.count({ where: { active: true, role: { permissions: { hasEvery: [...ACCESS_ADMIN_PERMISSIONS] } } } })).toBe(1);
  });

  it("concurrent role changes cannot leave nobody able to manage users and roles (ACCESS_LOCKOUT)", async () => {
    // Every other path is stopped earlier (an account that can do more than the actor can't be changed, and the
    // actor itself still counts), so only two admins demoting each other at once can reach the guard.
    const a = await loginAs("all");
    const b = await loginAs("all");
    const readers = await createRole(["books.view"], "Readers");
    const [r1, r2] = await Promise.all([
      a.agent.patch(`/api/users/${b.user.id}`).send({ roleId: readers.id }),
      b.agent.patch(`/api/users/${a.user.id}`).send({ roleId: readers.id }),
    ]);
    expect([r1.status, r2.status].filter((s) => s === 200)).toHaveLength(1);
    const loser = r1.status === 200 ? r2 : r1;
    // 409 when the loser's request was past the permission check before the demotion, 403 when it started after.
    expect([403, 409]).toContain(loser.status);
    if (loser.status === 409) expect(loser.body.error.code).toBe("ACCESS_LOCKOUT");
    expect(await prisma.user.count({ where: { active: true, role: { permissions: { hasEvery: [...ACCESS_ADMIN_PERMISSIONS] } } } })).toBe(1);
  });

  it("an account with permissions the actor lacks can't be reset, (de)activated or given another role (PERMISSION_ESCALATION)", async () => {
    const admin = await createUser({ permissions: "all" });
    const inactiveAdmin = await createUser({ permissions: "all", active: false });
    const helpdesk = ["users.view", "users.update", "users.deactivate", "users.reset_password", "roles.view"] as const;
    const { agent } = await loginAs(helpdesk);
    const nobody = await createRole([], "Nobody");
    for (const [target, body] of [
      [admin, { password: "Hijacked123" }],
      [admin, { active: false }],
      [admin, { roleId: nobody.id }],
      [inactiveAdmin, { active: true }],
    ] as const) {
      const before = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
      const res = await agent.patch(`/api/users/${target.id}`).send(body);
      expect(res.status, JSON.stringify(body)).toBe(403);
      expect(res.body.error.code).toBe("PERMISSION_ESCALATION");
      expect(await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).toEqual(before);
    }
    expect((await request(app).post("/api/auth/login").send({ email: admin.email, password: PASSWORD })).status).toBe(200);
    // Renaming is not a takeover.
    expect((await agent.patch(`/api/users/${admin.id}`).send({ name: "Renamed" })).status).toBe(200);

    // An account whose role is within the actor's permissions (here: the very same set) can be managed.
    const peer = await createUser({ permissions: helpdesk });
    expect((await agent.patch(`/api/users/${peer.id}`).send({ password: "BrandNew123" })).status).toBe(200);
    expect((await agent.patch(`/api/users/${peer.id}`).send({ active: false })).status).toBe(200);
    expect((await agent.patch(`/api/users/${peer.id}`).send({ active: true, roleId: nobody.id })).status).toBe(200);
  });
});
