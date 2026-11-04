/**
 * Check-then-act races, reproduced deterministically: a second connection holds a conflicting change
 * open (uncommitted) while the API request runs, and commits once the request is blocked on it.
 */
import { afterEach, describe, expect, it } from "vitest";
import pg from "pg";
import request from "supertest";
import { Prisma } from "../src/generated/prisma/client.js";
import { prisma } from "../src/lib/prisma.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { testDatabaseUrl } from "./db-url.js";
import { app, createBook, createLibrary, loginAs } from "./helpers.js";

const clients: pg.Client[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) await c.end().catch(() => {});
});

/** Opens a transaction on a separate connection and runs `sql` in it without committing. */
async function holdUncommitted(sql: string, params: unknown[]) {
  const url = new URL(testDatabaseUrl());
  url.search = "";
  const client = new pg.Client({ connectionString: url.toString() });
  clients.push(client);
  await client.connect();
  await client.query("BEGIN");
  await client.query(sql, params);
  return {
    /** Waits until another session is blocked on a lock held here, then commits. */
    async commitWhenBlocked() {
      const deadline = Date.now() + 10_000;
      for (;;) {
        const { rows } = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
        );
        if (rows[0]!.n > 0) break;
        if (Date.now() > deadline) throw new Error("the request never blocked on the held lock");
        await new Promise((r) => setTimeout(r, 25));
      }
      await client.query("COMMIT");
    },
  };
}

/** Starts a supertest request now (supertest is lazy) and returns its response promise. */
const start = (test: request.Test) => test.then((r) => r);

describe("grouping names are unique per library regardless of case, also under concurrency", () => {
  it("a concurrent insert in another capitalisation makes POST /categories return 409 (not a duplicate)", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary();
    const other = await holdUncommitted(
      `INSERT INTO "Category" ("id", "libraryId", "name", "updatedAt") VALUES ('race-cat', $1, 'fiction', NOW())`,
      [lib.id],
    );
    const res = start(agent.post(`/api/libraries/${lib.id}/categories`).send({ name: "Fiction" }));
    await other.commitWhenBlocked();
    const r = await res;
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("CATEGORY_EXISTS");
    expect(await prisma.category.count({ where: { libraryId: lib.id } })).toBe(1);
  });

  it("a concurrent rename to another capitalisation makes PATCH /categories return 409", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary();
    const c = await prisma.category.create({ data: { libraryId: lib.id, name: "Reference" } });
    const other = await holdUncommitted(
      `INSERT INTO "Category" ("id", "libraryId", "name", "updatedAt") VALUES ('race-cat', $1, 'FICTION', NOW())`,
      [lib.id],
    );
    const res = start(agent.patch(`/api/categories/${c.id}`).send({ name: "Fiction" }));
    await other.commitWhenBlocked();
    expect((await res).body.error.code).toBe("CATEGORY_EXISTS");
  });

  it("bulk add reuses a grouping created concurrently in another capitalisation and does not report it as created", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary();
    const other = await holdUncommitted(
      `INSERT INTO "Category" ("id", "libraryId", "name", "updatedAt") VALUES ('race-cat', $1, 'fiction', NOW())`,
      [lib.id],
    );
    const res = start(
      agent.post("/api/books/bulk").send({ libraryId: lib.id, books: [{ title: "A", categoryName: "Fiction" }, { title: "B", categoryName: "Poetry" }] }),
    );
    await other.commitWhenBlocked();
    const r = await res;
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ created: 2, categoriesCreated: ["Poetry"] });
    const cats = await prisma.category.findMany({ where: { libraryId: lib.id }, orderBy: { name: "asc" } });
    expect(cats.map((c) => c.name)).toEqual(["fiction", "Poetry"]);
    expect((await prisma.book.findFirstOrThrow({ where: { title: "A" } })).categoryId).toBe("race-cat");
  });

  it("parallel creates and bulk imports with different capitalisation end with one grouping", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary();
    const names = ["Fiction", "fiction", "FICTION", "FiCtIoN"];
    const results = await Promise.all([
      ...names.map((name) => agent.post(`/api/libraries/${lib.id}/categories`).send({ name }).then((r) => r)),
      ...names.map((name) => agent.post("/api/books/bulk").send({ libraryId: lib.id, books: [{ title: name, categoryName: name }] }).then((r) => r)),
    ]);
    const creates = results.slice(0, names.length);
    const bulks = results.slice(names.length);
    expect(bulks.every((r) => r.status === 201)).toBe(true);
    const createdByBulk = bulks.flatMap((r) => r.body.categoriesCreated as string[]);
    const createdByPost = creates.filter((r) => r.status === 201).length;
    expect(creates.every((r) => r.status === 201 || r.body.error.code === "CATEGORY_EXISTS")).toBe(true);
    expect(createdByPost + createdByBulk.length).toBe(1);
    const cats = await prisma.category.findMany({ where: { libraryId: lib.id } });
    expect(cats).toHaveLength(1);
    expect(await prisma.book.count({ where: { libraryId: lib.id, categoryId: cats[0]!.id } })).toBe(names.length);
  });

  it("the database itself refuses a case-only duplicate", async () => {
    const lib = await createLibrary();
    await prisma.category.create({ data: { libraryId: lib.id, name: "Fiction" } });
    await expect(prisma.category.create({ data: { libraryId: lib.id, name: "fICTION" } })).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("a delete racing a create returns the matching 4xx, never 500", () => {
  it("public request vs. book delete → 400 INVALID_BOOKS", async () => {
    const lib = await createLibrary({ slug: "parish", publicFormEnabled: true });
    const book = await createBook(lib.id);
    const keep = await createBook(lib.id);
    const del = await holdUncommitted(`DELETE FROM "Book" WHERE "id" = $1`, [book.id]);
    const res = start(
      request(app)
        .post("/api/public/libraries/parish/requests")
        .send({ borrower: { name: "Maria Clara", email: "maria@example.com" }, items: [{ bookId: keep.id, quantity: 1 }, { bookId: book.id, quantity: 1 }] }),
    );
    await del.commitWhenBlocked();
    const r = await res;
    expect(r.status).toBe(400);
    expect(r.body.error).toMatchObject({ code: "INVALID_BOOKS", details: { bookIds: [book.id] } });
    expect(await prisma.loan.count()).toBe(0);
  });

  it("staff loan vs. book delete → 400 INVALID_BOOKS", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary();
    const book = await createBook(lib.id);
    const del = await holdUncommitted(`DELETE FROM "Book" WHERE "id" = $1`, [book.id]);
    const res = start(agent.post("/api/loans").send({ libraryId: lib.id, borrower: { name: "Juan" }, items: [{ bookId: book.id, quantity: 1 }] }));
    await del.commitWhenBlocked();
    const r = await res;
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("INVALID_BOOKS");
  });

  it("pending item edit vs. book delete → 400 INVALID_BOOKS", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary({ slug: "parish", publicFormEnabled: true });
    const book = await createBook(lib.id);
    const added = await createBook(lib.id);
    const sent = await request(app)
      .post("/api/public/libraries/parish/requests")
      .send({ borrower: { name: "Maria Clara", email: "maria@example.com" }, items: [{ bookId: book.id, quantity: 1 }] });
    const loan = await prisma.loan.findFirstOrThrow({ where: { number: Number(String(sent.body.loanNumber).slice(3)) } });
    const del = await holdUncommitted(`DELETE FROM "Book" WHERE "id" = $1`, [added.id]);
    const res = start(agent.patch(`/api/loans/${loan.id}`).send({ items: [{ bookId: added.id, quantity: 1 }] }));
    await del.commitWhenBlocked();
    const r = await res;
    expect(r.status).toBe(400);
    expect(r.body.error).toMatchObject({ code: "INVALID_BOOKS", details: { bookIds: [added.id] } });
  });

  it("staff loan for an existing borrower vs. borrower delete → 404", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary();
    const book = await createBook(lib.id);
    const borrower = await prisma.borrower.create({ data: { name: "Juan" } });
    const del = await holdUncommitted(`DELETE FROM "Borrower" WHERE "id" = $1`, [borrower.id]);
    const res = start(agent.post("/api/loans").send({ libraryId: lib.id, borrowerId: borrower.id, items: [{ bookId: book.id, quantity: 1 }] }));
    await del.commitWhenBlocked();
    const r = await res;
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("NOT_FOUND");
    expect((await prisma.book.findUniqueOrThrow({ where: { id: book.id } })).availableCopies).toBe(1);
  });

  it("request with a known ID number vs. delete of that borrower → a new borrower is linked", async () => {
    const lib = await createLibrary({ slug: "parish", publicFormEnabled: true });
    const book = await createBook(lib.id);
    const old = await prisma.borrower.create({ data: { name: "Old Record", idNumber: "S-1" } });
    const del = await holdUncommitted(`DELETE FROM "Borrower" WHERE "id" = $1`, [old.id]);
    const res = start(
      request(app)
        .post("/api/public/libraries/parish/requests")
        .send({ borrower: { name: "Maria Clara", email: "maria@example.com", idNumber: "S-1" }, items: [{ bookId: book.id, quantity: 1 }] }),
    );
    await del.commitWhenBlocked();
    expect((await res).status).toBe(201);
    const loan = await prisma.loan.findFirstOrThrow({ include: { borrower: true } });
    expect(loan.borrower).toMatchObject({ name: "Maria Clara", idNumber: "S-1" });
  });

  it("request filling in the email of an ID-number match vs. a concurrent insert of that email → linked to that borrower", async () => {
    const lib = await createLibrary({ slug: "parish", publicFormEnabled: true });
    const book = await createBook(lib.id);
    await prisma.borrower.create({ data: { name: "By ID", idNumber: "S-2" } });
    const other = await holdUncommitted(
      `INSERT INTO "Borrower" ("id", "name", "email", "updatedAt") VALUES ('race-borrower', 'By Email', 'maria@example.com', NOW())`,
      [],
    );
    const res = start(
      request(app)
        .post("/api/public/libraries/parish/requests")
        .send({ borrower: { name: "Maria Clara", email: "maria@example.com", idNumber: "S-2" }, items: [{ bookId: book.id, quantity: 1 }] }),
    );
    await other.commitWhenBlocked();
    expect((await res).status).toBe(201);
    // The retry finds the borrower that now has this email; the ID-number match keeps no email.
    const loan = await prisma.loan.findFirstOrThrow();
    expect(loan.borrowerId).toBe("race-borrower");
    expect((await prisma.borrower.findUniqueOrThrow({ where: { idNumber: "S-2" } })).email).toBeNull();
  });

  it("add book vs. library delete → 404", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary();
    const del = await holdUncommitted(`DELETE FROM "Library" WHERE "id" = $1`, [lib.id]);
    const res = start(agent.post("/api/books").send({ libraryId: lib.id, title: "Noli Me Tangere" }));
    await del.commitWhenBlocked();
    const r = await res;
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("NOT_FOUND");
  });

  it("add book vs. delete of its grouping → 400 INVALID_CATEGORY", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary();
    const cat = await prisma.category.create({ data: { libraryId: lib.id, name: "Fiction" } });
    const del = await holdUncommitted(`DELETE FROM "Category" WHERE "id" = $1`, [cat.id]);
    const res = start(agent.post("/api/books").send({ libraryId: lib.id, title: "Noli Me Tangere", categoryId: cat.id }));
    await del.commitWhenBlocked();
    expect((await res).body.error.code).toBe("INVALID_CATEGORY");
  });

  it("the error handler maps any remaining foreign-key / write-conflict error to 409 CONFLICT", () => {
    for (const code of ["P2003", "P2034"]) {
      const err = new Prisma.PrismaClientKnownRequestError("race", { code, clientVersion: "test" });
      let status = 0;
      let body: unknown;
      const res = {
        headersSent: false,
        status(s: number) {
          status = s;
          return this;
        },
        json(b: unknown) {
          body = b;
          return this;
        },
      };
      errorHandler(err, {} as never, res as never, () => {});
      expect(status).toBe(409);
      expect(body).toMatchObject({ error: { code: "CONFLICT" } });
    }
  });
});
