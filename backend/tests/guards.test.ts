import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, createLibrary, loginAs } from "./helpers.js";

describe("authentication and admin-only guards", () => {
  it("staff endpoints require login", async () => {
    for (const path of ["/api/libraries", "/api/books", "/api/borrowers", "/api/loans", "/api/dashboard", "/api/users"]) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    }
    const post = await request(app).post("/api/loans").send({});
    expect(post.status).toBe(401);
  });

  it("STAFF gets 403 on ADMIN-only endpoints", async () => {
    const lib = await createLibrary();
    const { agent } = await loginAs("STAFF");
    const calls = [
      agent.post("/api/libraries").send({ name: "New" }),
      agent.patch(`/api/libraries/${lib.id}`).send({ name: "Renamed" }),
      agent.delete(`/api/libraries/${lib.id}`).send({}),
      agent.get("/api/users"),
      agent.post("/api/users").send({ email: "x@test.local", name: "X", password: "Password123", role: "STAFF" }),
      agent.patch("/api/users/whatever").send({ name: "X" }),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    }
  });

  it("STAFF can read libraries and manage categories/books/borrowers", async () => {
    const lib = await createLibrary();
    const { agent } = await loginAs("STAFF");
    expect((await agent.get("/api/libraries")).status).toBe(200);
    expect((await agent.get(`/api/libraries/${lib.id}`)).status).toBe(200);
    expect((await agent.post(`/api/libraries/${lib.id}/categories`).send({ name: "Fiction" })).status).toBe(201);
    expect((await agent.post("/api/books").send({ libraryId: lib.id, title: "Noli" })).status).toBe(201);
    expect((await agent.post("/api/borrowers").send({ name: "Jose Rizal" })).status).toBe(201);
  });

  it("ADMIN can use admin endpoints", async () => {
    const { agent } = await loginAs("ADMIN");
    expect((await agent.post("/api/libraries").send({ name: "Main" })).status).toBe(201);
    expect((await agent.get("/api/users")).status).toBe(200);
  });
});
