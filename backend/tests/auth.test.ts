import { describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { prisma } from "../src/lib/prisma.js";
import { app, createUser, loginAs, PASSWORD } from "./helpers.js";

describe("auth", () => {
  it("logs in with an httpOnly SameSite=Lax cookie and returns { user } without the hash", async () => {
    const user = await createUser("STAFF", { email: "staff@test.local" });
    const res = await request(app).post("/api/auth/login").send({ email: "  STAFF@Test.Local ", password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      user: { id: user.id, email: "staff@test.local", name: user.name, role: "STAFF", active: true, createdAt: user.createdAt.toISOString() },
    });
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/lms_token=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Secure/i); // not production
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });

  it("rejects wrong password, unknown email and inactive users with the same 401", async () => {
    await createUser("STAFF", { email: "a@test.local" });
    await createUser("STAFF", { email: "off@test.local", active: false });
    const wrong = await request(app).post("/api/auth/login").send({ email: "a@test.local", password: "nope-nope" });
    const unknown = await request(app).post("/api/auth/login").send({ email: "zz@test.local", password: PASSWORD });
    const inactive = await request(app).post("/api/auth/login").send({ email: "off@test.local", password: PASSWORD });
    for (const r of [wrong, unknown, inactive]) {
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe("INVALID_CREDENTIALS");
      expect(r.body.error.message).toBe(wrong.body.error.message);
    }
  });

  it("validates the login body", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.issues.map((i: { path: string[] }) => i.path[0])).toEqual(expect.arrayContaining(["email", "password"]));
  });

  it("GET /auth/me returns the user, 401 without a cookie or with a bad token", async () => {
    const { agent, user } = await loginAs("ADMIN");
    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ id: user.id, role: "ADMIN" });
    expect(me.body.user.passwordHash).toBeUndefined();

    const anon = await request(app).get("/api/auth/me");
    expect(anon.status).toBe(401);
    expect(anon.body.error.code).toBe("UNAUTHENTICATED");

    const forged = await request(app).get("/api/auth/me").set("Cookie", "lms_token=abc.def.ghi");
    expect(forged.status).toBe(401);
  });

  it("a deactivated user is rejected on the next request", async () => {
    const { agent, user } = await loginAs("STAFF");
    expect((await agent.get("/api/auth/me")).status).toBe(200);
    await prisma.user.update({ where: { id: user.id }, data: { active: false } });
    const res = await agent.get("/api/libraries");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("logout clears the cookie and is 204 even when not logged in", async () => {
    const { agent } = await loginAs("STAFF");
    const out = await agent.post("/api/auth/logout").send({});
    expect(out.status).toBe(204);
    expect(String(out.headers["set-cookie"])).toMatch(/lms_token=;/);
    expect((await agent.get("/api/auth/me")).status).toBe(401);
    expect((await request(app).post("/api/auth/logout").send({})).status).toBe(204);
  });

  it("changes the password (wrong current → 400 WRONG_PASSWORD, too short → 400)", async () => {
    const { agent, user } = await loginAs("STAFF");
    const wrong = await agent.patch("/api/auth/password").send({ currentPassword: "nope-nope", newPassword: "NewPassword1" });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe("WRONG_PASSWORD");
    const short = await agent.patch("/api/auth/password").send({ currentPassword: PASSWORD, newPassword: "short" });
    expect(short.status).toBe(400);
    expect(short.body.error.code).toBe("VALIDATION_ERROR");
    const ok = await agent.patch("/api/auth/password").send({ currentPassword: PASSWORD, newPassword: "NewPassword1" });
    expect(ok.status).toBe(204);
    const relog = await request(app).post("/api/auth/login").send({ email: user.email, password: "NewPassword1" });
    expect(relog.status).toBe(200);
  });

  it("limits new passwords to 72 bytes, since bcrypt ignores the rest", async () => {
    const { agent } = await loginAs("STAFF");
    // 40 characters but 80 bytes in UTF-8: within a character limit, over bcrypt's byte limit.
    const tooLong = "ñ".repeat(40);
    const res = await agent.patch("/api/auth/password").send({ currentPassword: PASSWORD, newPassword: tooLong });
    expect(res.status).toBe(400);
    expect(res.body.error.details.issues[0].path).toEqual(["newPassword"]);
    const fits = "ñ".repeat(36); // exactly 72 bytes
    expect((await agent.patch("/api/auth/password").send({ currentPassword: PASSWORD, newPassword: fits })).status).toBe(204);
  });

  it("a password change signs out every other session but keeps the current one", async () => {
    const { agent, user } = await loginAs("STAFF");
    const copied = request.agent(app); // e.g. a cookie left on a shared counter PC
    expect((await copied.post("/api/auth/login").send({ email: user.email, password: PASSWORD })).status).toBe(200);
    const res = await agent.patch("/api/auth/password").send({ currentPassword: PASSWORD, newPassword: "NewPassword1" });
    expect(res.status).toBe(204);
    expect(String(res.headers["set-cookie"])).toMatch(/lms_token=[^;]+;/);
    expect((await agent.get("/api/auth/me")).status).toBe(200);
    const stale = await copied.get("/api/auth/me");
    expect(stale.status).toBe(401);
    expect(stale.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("logout invalidates the token itself, not only the browser cookie", async () => {
    const { user } = await loginAs("STAFF");
    const login = await request(app).post("/api/auth/login").send({ email: user.email, password: PASSWORD });
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(200);
    expect((await request(app).post("/api/auth/logout").set("Cookie", cookie).send({})).status).toBe(204);
    // A copy of the cookie made before logout no longer works.
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(401);
    // Logging out with a stale token is still 204 and changes nothing.
    expect((await request(app).post("/api/auth/logout").set("Cookie", cookie).send({})).status).toBe(204);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).tokenVersion).toBe(1);
  });

  it("rejects tokens without a token version (issued before versioning)", async () => {
    const { user } = await loginAs("STAFF");
    const legacy = jwt.sign({ sub: user.id }, env.jwtSecret, { expiresIn: 3600, algorithm: "HS256" });
    expect((await request(app).get("/api/auth/me").set("Cookie", `lms_token=${legacy}`)).status).toBe(401);
  });

  it("rate-limits login to 10 per 15 minutes per IP when enabled", async () => {
    const limited = createApp({ rateLimit: true });
    for (let i = 0; i < 10; i++) {
      const r = await request(limited).post("/api/auth/login").send({ email: "x@test.local", password: "whatever1" });
      expect(r.status).toBe(401);
    }
    const blocked = await request(limited).post("/api/auth/login").send({ email: "x@test.local", password: "whatever1" });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
  });

  it("does not count successful logins toward the login rate limit (shared office IPs)", async () => {
    const limited = createApp({ rateLimit: true });
    const user = await createUser("STAFF");
    for (let i = 0; i < 12; i++) {
      const ok = await request(limited).post("/api/auth/login").send({ email: user.email, password: PASSWORD });
      expect(ok.status).toBe(200);
    }
    for (let i = 0; i < 10; i++) {
      const r = await request(limited).post("/api/auth/login").send({ email: user.email, password: "wrong-password" });
      expect(r.status).toBe(401);
    }
    const blocked = await request(limited).post("/api/auth/login").send({ email: user.email, password: PASSWORD });
    expect(blocked.status).toBe(429);
  });
});

describe("cross-cutting HTTP behaviour", () => {
  it("health check stays public", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("unknown /api route → 404 NOT_FOUND", async () => {
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("state-changing requests without JSON content type → 415", async () => {
    const res = await request(app).post("/api/auth/logout").set("Content-Type", "text/plain").send("x");
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    const form = await request(app).post("/api/auth/login").type("form").send({ email: "a", password: "b" });
    expect(form.status).toBe(415);
    const noBody = await request(app).delete("/api/books/x");
    expect(noBody.status).toBe(415);
  });

  it("malformed JSON → 400 VALIDATION_ERROR", async () => {
    const res = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("{bad");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("CORS allows only CORS_ORIGIN, with credentials", async () => {
    const ok = await request(app).get("/api/health").set("Origin", "http://localhost:5173");
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(ok.headers["access-control-allow-credentials"]).toBe("true");
    const bad = await request(app).get("/api/health").set("Origin", "http://evil.example");
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("sets helmet security headers", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});
