import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { app, createBook, createLibrary, getBook, loginAs } from "./helpers.js";

async function enabledLibrary() {
  const lib = await createLibrary({ name: "Parish Library", slug: "parish", publicFormEnabled: true, defaultLoanDays: 14 });
  const cat = await prisma.category.create({ data: { libraryId: lib.id, name: "Spirituality" } });
  return { lib, cat };
}

const BORROWER_FIELDS = /idNumber|"contact"|affiliation|borrower|"email"|staffNotes|submittedName|passwordHash|"notes"/;

describe("public library form", () => {
  it("GET /public/libraries/:slug returns only public library info + categories", async () => {
    const { cat } = await enabledLibrary();
    const res = await request(app).get("/api/public/libraries/parish");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      library: { name: "Parish Library", slug: "parish", description: null, location: null, defaultLoanDays: 14 },
      categories: [{ id: cat.id, name: "Spirituality" }],
    });
  });

  it("disabled form and unknown slug give the same 404", async () => {
    await createLibrary({ slug: "closed", publicFormEnabled: false });
    const closed = await request(app).get("/api/public/libraries/closed");
    const unknown = await request(app).get("/api/public/libraries/nope");
    expect(closed.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(closed.body).toEqual(unknown.body);
    expect(closed.body.error.code).toBe("NOT_FOUND");
    expect((await request(app).get("/api/public/libraries/closed/books")).status).toBe(404);
    const post = await request(app).post("/api/public/libraries/closed/requests").send({ borrower: { name: "Juan", email: "juan@example.com" }, items: [{ bookId: "x", quantity: 1 }] });
    expect(post.status).toBe(404);
  });

  it("lists non-archived books with available flag only (no counts)", async () => {
    const { lib, cat } = await enabledLibrary();
    const out = await createBook(lib.id, { title: "Bible", totalCopies: 1, categoryId: cat.id });
    await prisma.book.update({ where: { id: out.id }, data: { availableCopies: 0 } });
    const inStock = await createBook(lib.id, { title: "Catechism", totalCopies: 4 });
    await createBook(lib.id, { title: "Archived", archived: true });
    const res = await request(app).get("/api/public/libraries/parish/books");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [
        { id: out.id, title: "Bible", author: null, callNumber: null, category: { id: cat.id, name: "Spirituality" }, available: false, coverUrl: null },
        { id: inStock.id, title: "Catechism", author: null, callNumber: null, category: null, available: true, coverUrl: null },
      ],
      total: 2,
      page: 1,
      pageSize: 20,
    });
    expect((await request(app).get("/api/public/libraries/parish/books?q=cate")).body.total).toBe(1);
    expect((await request(app).get(`/api/public/libraries/parish/books?categoryId=${cat.id}`)).body.total).toBe(1);
    expect((await request(app).get("/api/public/libraries/parish/books?pageSize=51")).status).toBe(400);
    expect((await request(app).get("/api/public/libraries/parish/books?pageSize=50")).status).toBe(200);
    // available=true: only books with a copy on the shelf now
    const available = await request(app).get("/api/public/libraries/parish/books?available=true");
    expect(available.body).toMatchObject({ total: 1, data: [{ id: inStock.id, available: true }] });
    expect((await request(app).get("/api/public/libraries/parish/books?available=yes")).status).toBe(400);
  });

  it("POST request creates a PENDING loan with no stock change, even for unavailable books", async () => {
    const { lib } = await enabledLibrary();
    const book = await createBook(lib.id, { totalCopies: 1 });
    await prisma.book.update({ where: { id: book.id }, data: { availableCopies: 0 } });
    const res = await request(app)
      .post("/api/public/libraries/parish/requests")
      .send({ borrower: { name: " Maria Clara ", email: " Maria.Clara@Example.COM ", idNumber: "", contact: "0917" }, items: [{ bookId: book.id, quantity: 2 }], notes: "Pick up Sunday", website: "" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ loanNumber: "BR-000001", status: "PENDING" });
    const loan = await prisma.loan.findUniqueOrThrow({ where: { number: 1 }, include: { items: true, borrower: true } });
    expect(loan).toMatchObject({ source: "PUBLIC_FORM", status: "PENDING", submittedName: "Maria Clara", notes: "Pick up Sunday", createdById: null, dueDate: null });
    expect(loan.borrower).toMatchObject({ name: "Maria Clara", email: "maria.clara@example.com", idNumber: null, contact: "0917", passwordHash: null });
    expect(loan.items).toHaveLength(1);
    expect(await getBook(book.id)).toMatchObject({ availableCopies: 0 });
  });

  it("links an existing borrower by idNumber without overwriting details (only a missing email is filled in); keeps submittedName", async () => {
    const { lib } = await enabledLibrary();
    const book = await createBook(lib.id);
    const existing = await prisma.borrower.create({ data: { name: "Jose Rizal", idNumber: "P-1", contact: "orig" } });
    const res = await request(app)
      .post("/api/public/libraries/parish/requests")
      .send({ borrower: { name: "Someone Else", email: "jose@example.com", idNumber: "P-1", contact: "new" }, items: [{ bookId: book.id, quantity: 1 }] });
    expect(res.status).toBe(201);
    const loan = await prisma.loan.findFirstOrThrow({ include: { borrower: true } });
    expect(loan.borrowerId).toBe(existing.id);
    expect(loan.borrower).toMatchObject({ name: "Jose Rizal", contact: "orig", email: "jose@example.com" });
    expect(loan.submittedName).toBe("Someone Else");
  });

  it("honeypot, archived book, other-library book, limits", async () => {
    const { lib } = await enabledLibrary();
    const other = await createLibrary();
    const book = await createBook(lib.id);
    const archived = await createBook(lib.id, { archived: true });
    const foreign = await createBook(other.id);
    const url = "/api/public/libraries/parish/requests";
    const borrower = { name: "Juan", email: "juan@example.com" };

    const bot = await request(app).post(url).send({ borrower, items: [{ bookId: book.id, quantity: 1 }], website: "http://spam" });
    expect(bot.status).toBe(400);
    expect(bot.body.error.code).toBe("VALIDATION_ERROR");

    const arch = await request(app).post(url).send({ borrower, items: [{ bookId: archived.id, quantity: 1 }] });
    expect(arch.status).toBe(400);
    expect(arch.body.error).toMatchObject({ code: "INVALID_BOOKS", details: { bookIds: [archived.id] } });

    const far = await request(app).post(url).send({ borrower, items: [{ bookId: foreign.id, quantity: 1 }] });
    expect(far.status).toBe(400);
    expect(far.body.error).toMatchObject({ code: "INVALID_BOOKS", details: { bookIds: [foreign.id] } });

    const qty = await request(app).post(url).send({ borrower, items: [{ bookId: book.id, quantity: 6 }] });
    expect(qty.status).toBe(400);
    expect(qty.body.error.details.issues[0].path).toEqual(["items", 0, "quantity"]);
    const shortName = await request(app).post(url).send({ borrower: { name: "J", email: "j@example.com" }, items: [{ bookId: book.id, quantity: 1 }] });
    expect(shortName.body.error.details.issues[0].path).toEqual(["borrower", "name"]);
    const many = await request(app).post(url).send({ borrower, items: Array.from({ length: 21 }, (_, i) => ({ bookId: `b${i}`, quantity: 1 })) });
    expect(many.status).toBe(400);
    const dup = await request(app).post(url).send({ borrower, items: [{ bookId: book.id, quantity: 1 }, { bookId: book.id, quantity: 1 }] });
    expect(dup.status).toBe(400);

    expect(await prisma.loan.count()).toBe(0);
    expect(await prisma.borrower.count()).toBe(0);
  });

  it("request status check: by any loan-number form, scoped to the library, no personal data", async () => {
    const { lib } = await enabledLibrary();
    const other = await createLibrary({ slug: "other-lib", publicFormEnabled: true });
    const book = await createBook(lib.id, { totalCopies: 2 });
    await request(app).post("/api/public/libraries/parish/requests").send({ borrower: { name: "Maria Clara", email: "maria@example.com", idNumber: "SECRET-ID", contact: "0917" }, items: [{ bookId: book.id, quantity: 1 }], notes: "private" });
    // BR- request number, the old LN- form and a bare number all work
    for (const n of ["BR-000001", "br-1", "BR000001", "LN-000001", "ln-1", "1"]) {
      const res = await request(app).get(`/api/public/requests/${n}?slug=parish`);
      expect(res.status, n).toBe(200);
      expect(res.body).toEqual({ loanNumber: "BR-000001", status: "PENDING", requestedAt: expect.any(String), dueDate: null });
      expect(JSON.stringify(res.body)).not.toMatch(/Maria|maria|SECRET|0917|private/);
    }
    expect((await request(app).get(`/api/public/requests/BR-000001?slug=${other.slug}`)).status).toBe(404);
    expect((await request(app).get("/api/public/requests/BR-000099?slug=parish")).status).toBe(404);
    expect((await request(app).get("/api/public/requests/BR-000001")).status).toBe(400);
    expect((await request(app).get("/api/public/requests/XX-000001?slug=parish")).status).toBe(404);

    // after approval the due date shows; disabling the form hides it
    const { agent } = await loginAs("staff");
    const loan = await prisma.loan.findFirstOrThrow();
    const approved = await agent.post(`/api/loans/${loan.id}/approve`).send({});
    const after = await request(app).get("/api/public/requests/1?slug=parish");
    expect(after.body).toMatchObject({ status: "BORROWED", dueDate: approved.body.dueDate });
    await prisma.library.update({ where: { id: lib.id }, data: { publicFormEnabled: false } });
    expect((await request(app).get("/api/public/requests/1?slug=parish")).status).toBe(404);
  });

  it("public responses never contain borrower or user data", async () => {
    const { lib } = await enabledLibrary();
    const book = await createBook(lib.id);
    await loginAs("all");
    const responses = [
      await request(app).get("/api/public/libraries"),
      await request(app).get("/api/public/libraries/parish"),
      await request(app).get("/api/public/libraries/parish/books"),
      await request(app).post("/api/public/libraries/parish/requests").send({ borrower: { name: "Maria Clara", email: "maria@example.com", idNumber: "X1" }, items: [{ bookId: book.id, quantity: 1 }] }),
      await request(app).get("/api/public/requests/1?slug=parish"),
      await request(app).get("/api/public/company"),
    ];
    for (const r of responses) {
      expect(r.status).toBeLessThan(300);
      const text = JSON.stringify(r.body);
      expect(text).not.toMatch(BORROWER_FIELDS);
      expect(text).not.toMatch(/Maria|maria|X1|@test\.local|\$2[aby]\$/);
    }
  });

  it("successful requests from one shared IP only count toward the larger limit (60 / 15 min)", async () => {
    const { lib } = await enabledLibrary();
    const book = await createBook(lib.id, { totalCopies: 1 });
    const limited = createApp({ rateLimit: true });
    const send = () =>
      request(limited)
        .post("/api/public/libraries/parish/requests")
        .send({ borrower: { name: "Student", email: "student@example.com" }, items: [{ bookId: book.id, quantity: 1 }] });
    // e.g. a whole class on the school Wi-Fi, or everyone behind the dev/preview proxy (one IP)
    for (let i = 0; i < 60; i++) expect((await send()).status).toBe(201);
    const blocked = await send();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
  });

  it("rate-limits failed requests (10 / 15 min) and status checks (30 / 15 min) when enabled", async () => {
    await enabledLibrary();
    const limited = createApp({ rateLimit: true });
    for (let i = 0; i < 10; i++) {
      const r = await request(limited).post("/api/public/libraries/parish/requests").send({ borrower: { name: "Juan" }, items: [] });
      expect(r.status).toBe(400);
    }
    const blocked = await request(limited).post("/api/public/libraries/parish/requests").send({ borrower: { name: "Juan" }, items: [] });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
    for (let i = 0; i < 30; i++) {
      expect((await request(limited).get("/api/public/requests/1?slug=parish")).status).toBe(404);
    }
    expect((await request(limited).get("/api/public/requests/1?slug=parish")).status).toBe(429);
  });
});
