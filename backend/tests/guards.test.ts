import { describe, expect, it } from "vitest";
import request from "supertest";
import { ALL_PERMISSIONS, normalizePermissions, type Permission } from "../src/lib/permissions.js";
import { prisma } from "../src/lib/prisma.js";
import { app, createBook, createLibrary, createRole, createUser, loginAs } from "./helpers.js";

type Agent = Awaited<ReturnType<typeof loginAs>>["agent"];
type Method = "get" | "post" | "put" | "patch" | "delete";

/** Every gated endpoint and the permission it needs (docs/SPEC.md). Ids are fake: the gate runs first. */
const GATED: { method: Method; path: string; perm: Permission; body?: object }[] = [
  { method: "get", path: "/api/dashboard", perm: "dashboard.view" },

  { method: "get", path: "/api/libraries/x", perm: "libraries.view" },
  { method: "post", path: "/api/libraries", perm: "libraries.create", body: { name: "New" } },
  { method: "patch", path: "/api/libraries/x", perm: "libraries.update", body: { name: "Renamed" } },
  { method: "delete", path: "/api/libraries/x", perm: "libraries.delete" },

  { method: "post", path: "/api/libraries/x/categories", perm: "categories.create", body: { name: "Fiction" } },
  { method: "patch", path: "/api/categories/x", perm: "categories.update", body: { name: "Renamed" } },
  { method: "delete", path: "/api/categories/x", perm: "categories.delete" },

  { method: "get", path: "/api/books", perm: "books.view" },
  { method: "get", path: "/api/books/x", perm: "books.view" },
  { method: "get", path: "/api/books/x/cover", perm: "books.view" },
  { method: "post", path: "/api/books", perm: "books.create", body: { libraryId: "x", title: "T" } },
  { method: "post", path: "/api/books/bulk", perm: "books.create", body: { libraryId: "x", books: [{ title: "T" }] } },
  { method: "patch", path: "/api/books/x", perm: "books.update", body: { title: "T" } },
  { method: "patch", path: "/api/books/x", perm: "books.delete", body: { archived: true } },
  { method: "put", path: "/api/books/x/cover", perm: "books.update", body: { image: "data:," } },
  { method: "delete", path: "/api/books/x/cover", perm: "books.update" },
  { method: "delete", path: "/api/books/x", perm: "books.delete" },

  { method: "get", path: "/api/borrowers", perm: "borrowers.view" },
  { method: "get", path: "/api/borrowers/x", perm: "borrowers.view" },
  { method: "post", path: "/api/borrowers", perm: "borrowers.create", body: { name: "Jose Rizal" } },
  { method: "patch", path: "/api/borrowers/x", perm: "borrowers.update", body: { name: "Jose Rizal" } },
  { method: "delete", path: "/api/borrowers/x", perm: "borrowers.delete" },

  { method: "get", path: "/api/loans", perm: "loans.view" },
  { method: "get", path: "/api/loans/x", perm: "loans.view" },
  { method: "post", path: "/api/loans", perm: "loans.create", body: { libraryId: "x", borrowerId: "x", items: [{ bookId: "x", quantity: 1 }] } },
  { method: "patch", path: "/api/loans/x", perm: "loans.update", body: { notes: "n" } },
  { method: "post", path: "/api/loans/x/approve", perm: "loans.approve", body: {} },
  { method: "post", path: "/api/loans/x/reject", perm: "loans.approve", body: { reason: "No" } },
  { method: "post", path: "/api/loans/x/notify", perm: "loans.approve" },
  { method: "post", path: "/api/loans/x/cancel", perm: "loans.cancel", body: {} },
  { method: "post", path: "/api/loans/x/returns", perm: "loans.return", body: { items: [] } },

  { method: "get", path: "/api/users", perm: "users.view" },
  { method: "post", path: "/api/users", perm: "users.create", body: { email: "x@test.local", name: "X", password: "Password123", roleId: "x" } },
  { method: "patch", path: "/api/users/x", perm: "users.update", body: { name: "X" } },
  { method: "patch", path: "/api/users/x", perm: "users.update", body: { roleId: "x" } },
  { method: "patch", path: "/api/users/x", perm: "users.deactivate", body: { active: false } },
  { method: "patch", path: "/api/users/x", perm: "users.reset_password", body: { password: "Password123" } },

  { method: "get", path: "/api/roles", perm: "roles.view" },
  { method: "get", path: "/api/roles/x", perm: "roles.view" },
  { method: "post", path: "/api/roles", perm: "roles.create", body: { name: "R", permissions: [] } },
  { method: "patch", path: "/api/roles/x", perm: "roles.update", body: { name: "R" } },
  { method: "delete", path: "/api/roles/x", perm: "roles.delete" },

  { method: "put", path: "/api/company", perm: "company.update", body: { name: "" } },
  { method: "put", path: "/api/company/logo", perm: "company.update", body: { mimeType: "image/png", data: "" } },
  { method: "delete", path: "/api/company/logo", perm: "company.update" },

  { method: "get", path: "/api/me/loans", perm: "my_books.view" },
];

const send = (agent: Agent, e: (typeof GATED)[number]) => agent[e.method](e.path).send(e.body ?? {});

/** Every permission except `perm` and everything that requires it (normalizing would add `perm` back). */
const allExcept = (perm: Permission) => ALL_PERMISSIONS.filter((p) => !normalizePermissions([p]).includes(perm));

describe("authentication and permission guards", () => {
  it("staff endpoints require login", async () => {
    for (const path of ["/api/libraries", "/api/books", "/api/borrowers", "/api/loans", "/api/dashboard", "/api/users", "/api/roles", "/api/permissions", "/api/me/loans"]) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    }
    const post = await request(app).post("/api/loans").send({});
    expect(post.status).toBe(401);
    expect((await request(app).put("/api/company").send({ name: "X" })).status).toBe(401);
  });

  it("every gated endpoint returns 403 FORBIDDEN without its permission, and passes the gate with it", async () => {
    // Every module of the catalog is covered.
    expect(new Set(GATED.map((e) => e.perm))).toEqual(new Set(ALL_PERMISSIONS));
    const agents = new Map<string, Agent>();
    const agentFor = async (perms: Permission[]) => {
      const key = perms.join(",");
      if (!agents.has(key)) agents.set(key, (await loginAs(perms)).agent);
      return agents.get(key)!;
    };
    for (const e of GATED) {
      const label = `${e.method.toUpperCase()} ${e.path} ${JSON.stringify(e.body ?? {})} (${e.perm})`;
      const without = await send(await agentFor(allExcept(e.perm)), e);
      expect(without.status, label).toBe(403);
      expect(without.body.error.code, label).toBe("FORBIDDEN");
      // With just that permission (and what it requires) the request gets past the gate (404/400/... instead).
      const withIt = await send(await agentFor(normalizePermissions([e.perm])), e);
      expect(withIt.status, label).not.toBe(403);
      expect(withIt.status, label).not.toBe(401);
    }
  });

  it("archiving needs books.delete, a new grouping needs categories.create, a new borrower needs borrowers.create", async () => {
    const lib = await createLibrary();
    const existing = await prisma.category.create({ data: { libraryId: lib.id, name: "Fiction" } });
    const book = await createBook(lib.id, { totalCopies: 2 });
    const editor = (await loginAs(normalizePermissions(["books.create", "books.update", "loans.create"]))).agent;
    const expectForbidden = (res: request.Response, label: string) => {
      expect(res.status, label).toBe(403);
      expect(res.body.error.code, label).toBe("FORBIDDEN");
    };

    // Archive / restore = "Delete / archive books" (books.delete); other fields = books.update.
    expectForbidden(await editor.patch(`/api/books/${book.id}`).send({ archived: true }), "archive");
    expectForbidden(await editor.patch(`/api/books/${book.id}`).send({ title: "T", archived: false }), "restore");
    const archiver = (await loginAs(normalizePermissions(["books.delete"]))).agent;
    expect((await archiver.patch(`/api/books/${book.id}`).send({ archived: true })).body.archived).toBe(true);
    expect((await archiver.patch(`/api/books/${book.id}`).send({ archived: false })).body.archived).toBe(false);
    expectForbidden(await archiver.patch(`/api/books/${book.id}`).send({ title: "T", archived: true }), "archiver edit");
    expect((await prisma.book.findUniqueOrThrow({ where: { id: book.id } })).archived).toBe(false);

    // A grouping typed by name: an existing one (any capitalisation) is fine, a new one needs categories.create.
    expectForbidden(await editor.post("/api/books").send({ libraryId: lib.id, title: "A", categoryName: "Poetry" }), "create");
    expectForbidden(
      await editor.post("/api/books/bulk").send({ libraryId: lib.id, books: [{ title: "B" }, { title: "C", categoryName: "Poetry" }] }),
      "bulk",
    );
    expectForbidden(await editor.patch(`/api/books/${book.id}`).send({ categoryName: "Poetry" }), "update");
    expect(await prisma.category.count({ where: { libraryId: lib.id } })).toBe(1);
    expect(await prisma.book.count({ where: { libraryId: lib.id } })).toBe(1);
    const reuse = await editor.post("/api/books").send({ libraryId: lib.id, title: "A", categoryName: "fiction" });
    expect(reuse.status).toBe(201);
    expect(reuse.body.category).toMatchObject({ id: existing.id });
    const bulk = await editor.post("/api/books/bulk").send({ libraryId: lib.id, books: [{ title: "B", categoryName: "FICTION" }] });
    expect(bulk.status).toBe(201);
    expect(bulk.body.categoriesCreated).toEqual([]);
    const curator = (await loginAs(normalizePermissions(["books.create", "categories.create"]))).agent;
    const created = await curator.post("/api/books").send({ libraryId: lib.id, title: "D", categoryName: "Poetry" });
    expect(created.status).toBe(201);

    // A borrower entered inline in the Borrow Books form.
    const items = [{ bookId: book.id, quantity: 1 }];
    expectForbidden(await editor.post("/api/loans").send({ libraryId: lib.id, borrower: { name: "Jose Rizal" }, items }), "borrower");
    expect(await prisma.borrower.count()).toBe(0);
    const borrower = await prisma.borrower.create({ data: { name: "Andres Bonifacio" } });
    expect((await editor.post("/api/loans").send({ libraryId: lib.id, borrowerId: borrower.id, items })).status).toBe(201);
    const lender = (await loginAs(normalizePermissions(["loans.create", "borrowers.create"]))).agent;
    expect((await lender.post("/api/loans").send({ libraryId: lib.id, borrower: { name: "Jose Rizal" }, items })).status).toBe(201);
  });

  it("reference data stays readable without any permission", async () => {
    const lib = await createLibrary();
    const { agent } = await loginAs([]);
    expect((await agent.get("/api/libraries")).status).toBe(200);
    expect((await agent.get(`/api/libraries/${lib.id}/categories`)).status).toBe(200);
    expect((await agent.get("/api/permissions")).status).toBe(200);
    expect((await agent.get("/api/auth/me")).status).toBe(200);
  });

  it("nobody bypasses permissions: a role named Administrator without users.view gets 403", async () => {
    const role = await createRole(ALL_PERMISSIONS.filter((p) => !p.startsWith("users.")), "Administrator");
    const user = await createUser({ roleId: role.id });
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: user.email, password: "Password123!" });
    const res = await agent.get("/api/users");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("the default Staff role gets 403 on library admin, users and roles", async () => {
    const lib = await createLibrary();
    const { agent } = await loginAs("staff");
    const calls = [
      agent.post("/api/libraries").send({ name: "New" }),
      agent.patch(`/api/libraries/${lib.id}`).send({ name: "Renamed" }),
      agent.delete(`/api/libraries/${lib.id}`).send({}),
      agent.get("/api/users"),
      agent.post("/api/users").send({ email: "x@test.local", name: "X", password: "Password123", roleId: "x" }),
      agent.patch("/api/users/whatever").send({ name: "X" }),
      agent.get("/api/roles"),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    }
  });

  it("the default Staff role can read libraries and manage categories/books/borrowers", async () => {
    const lib = await createLibrary();
    const { agent } = await loginAs("staff");
    expect((await agent.get("/api/libraries")).status).toBe(200);
    expect((await agent.get(`/api/libraries/${lib.id}`)).status).toBe(200);
    expect((await agent.post(`/api/libraries/${lib.id}/categories`).send({ name: "Fiction" })).status).toBe(201);
    expect((await agent.post("/api/books").send({ libraryId: lib.id, title: "Noli" })).status).toBe(201);
    expect((await agent.post("/api/borrowers").send({ name: "Jose Rizal" })).status).toBe(201);
  });

  it("a role with every permission can use admin endpoints", async () => {
    const { agent } = await loginAs("all");
    expect((await agent.post("/api/libraries").send({ name: "Main" })).status).toBe(201);
    expect((await agent.get("/api/users")).status).toBe(200);
    expect((await agent.get("/api/roles")).status).toBe(200);
  });
});
