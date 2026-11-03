import { describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../src/lib/prisma.js";
import { app, createUser, loginAs, PASSWORD } from "./helpers.js";

describe("users (admin)", () => {
  it("creates, lists (sorted by name) and never returns password hashes", async () => {
    const { agent } = await loginAs("ADMIN");
    const res = await agent.post("/api/users").send({ email: " New.Staff@Test.Local ", name: "Zed Staff", password: "Password123", role: "STAFF" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.any(String), email: "new.staff@test.local", name: "Zed Staff", role: "STAFF", active: true, createdAt: expect.any(String) });
    const dup = await agent.post("/api/users").send({ email: "NEW.STAFF@test.local", name: "Dup", password: "Password123", role: "STAFF" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("EMAIL_TAKEN");
    const bad = await agent.post("/api/users").send({ email: "not-an-email", name: "", password: "short", role: "BOSS" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.issues.map((i: { path: string[] }) => i.path[0]).sort()).toEqual(["email", "name", "password", "role"]);
    const list = await agent.get("/api/users");
    expect(list.body.data.map((u: { name: string }) => u.name)).toEqual(["Admin 1", "Zed Staff"].sort());
    expect(JSON.stringify(list.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
    const login = await request(app).post("/api/auth/login").send({ email: "new.staff@test.local", password: "Password123" });
    expect(login.status).toBe(200);
  });

  it("accepts local addresses without a dot in the host (e.g. staff@localhost)", async () => {
    const { agent } = await loginAs("ADMIN");
    const res = await agent.post("/api/users").send({ email: "Staff@LocalHost", name: "Local", password: "Password123", role: "STAFF" });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe("staff@localhost");
    const login = await request(app).post("/api/auth/login").send({ email: "staff@localhost", password: "Password123" });
    expect(login.status).toBe(200);
  });

  it("updates name/role/active and resets passwords; email is immutable", async () => {
    const { agent } = await loginAs("ADMIN");
    const staff = await createUser("STAFF");
    const res = await agent.patch(`/api/users/${staff.id}`).send({ name: "Renamed", role: "ADMIN", email: "changed@test.local" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Renamed", role: "ADMIN", email: staff.email });
    const reset = await agent.patch(`/api/users/${staff.id}`).send({ password: "BrandNew123" });
    expect(reset.status).toBe(200);
    expect((await request(app).post("/api/auth/login").send({ email: staff.email, password: PASSWORD })).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ email: staff.email, password: "BrandNew123" })).status).toBe(200);
    const off = await agent.patch(`/api/users/${staff.id}`).send({ active: false });
    expect(off.body.active).toBe(false);
    expect((await request(app).post("/api/auth/login").send({ email: staff.email, password: "BrandNew123" })).status).toBe(401);
    expect((await agent.patch("/api/users/missing").send({ name: "X" })).status).toBe(404);
  });

  it("an admin password reset or deactivation ends the user's existing sessions", async () => {
    const { agent } = await loginAs("ADMIN");
    const staff = await loginAs("STAFF");
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
    const { agent, user } = await loginAs("ADMIN");
    const res = await agent.patch(`/api/users/${user.id}`).send({ password: "MyNewPass123" });
    expect(res.status).toBe(200);
    expect((await agent.get("/api/auth/me")).status).toBe(200);
    const long = await agent.post("/api/users").send({ email: "e@test.local", name: "E", password: "😀".repeat(19), role: "STAFF" });
    expect(long.status).toBe(400); // 19 characters, 76 bytes
    expect(long.body.error.details.issues.map((i: { path: string[] }) => i.path[0])).toEqual(["password"]);
  });

  it("an admin cannot deactivate or demote themselves (SELF_MODIFICATION)", async () => {
    const { agent, user } = await loginAs("ADMIN");
    await createUser("ADMIN");
    for (const body of [{ active: false }, { role: "STAFF" }]) {
      const res = await agent.patch(`/api/users/${user.id}`).send(body);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("SELF_MODIFICATION");
    }
    const rename = await agent.patch(`/api/users/${user.id}`).send({ name: "Still me" });
    expect(rename.status).toBe(200);
  });

  it("always keeps at least one active admin, even under concurrent demotions (LAST_ADMIN)", async () => {
    const a = await loginAs("ADMIN");
    const b = await loginAs("ADMIN");
    const [r1, r2] = await Promise.all([
      a.agent.patch(`/api/users/${b.user.id}`).send({ active: false }),
      b.agent.patch(`/api/users/${a.user.id}`).send({ active: false }),
    ]);
    const statuses = [r1.status, r2.status];
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    const loser = r1.status === 200 ? r2 : r1;
    expect([401, 409]).toContain(loser.status);
    if (loser.status === 409) expect(loser.body.error.code).toBe("LAST_ADMIN");
    expect(await prisma.user.count({ where: { role: "ADMIN", active: true } })).toBe(1);
  });
});
