import { describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../src/lib/prisma.js";
import { app, createBook, createLibrary, loginAs } from "./helpers.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

const requestUrl = "/api/public/libraries/parish/requests";

async function parish() {
  return createLibrary({ name: "Parish Library", slug: "parish", publicFormEnabled: true, defaultLoanDays: 14 });
}

describe("public catalog", () => {
  it("GET /public/libraries lists only libraries with a public form, by name, without ids", async () => {
    await createLibrary({ name: "Zeta Library", slug: "zeta", publicFormEnabled: true });
    await createLibrary({ name: "Closed Library", slug: "closed", publicFormEnabled: false });
    await createLibrary({ name: "Alpha Library", slug: "alpha", publicFormEnabled: true, defaultLoanDays: 3 });
    const res = await request(app).get("/api/public/libraries");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [
        { name: "Alpha Library", slug: "alpha", description: null, location: null, defaultLoanDays: 3 },
        { name: "Zeta Library", slug: "zeta", description: null, location: null, defaultLoanDays: 7 },
      ],
    });
  });

  it("serves a book's picture only for non-archived books of an enabled library", async () => {
    const lib = await parish();
    const closed = await createLibrary({ slug: "closed", publicFormEnabled: false });
    const withCover = await createBook(lib.id, { title: "Bible" });
    const noCover = await createBook(lib.id, { title: "Catechism" });
    const archived = await createBook(lib.id, { title: "Old", archived: true });
    const closedBook = await createBook(closed.id);
    for (const b of [withCover, archived, closedBook]) {
      await prisma.bookCover.create({ data: { bookId: b.id, mimeType: "image/png", data: new Uint8Array(PNG) } });
    }

    const list = await request(app).get("/api/public/libraries/parish/books");
    const url: string = list.body.data.find((b: { id: string }) => b.id === withCover.id).coverUrl;
    expect(url).toMatch(new RegExp(`^/api/public/libraries/parish/books/${withCover.id}/cover\\?v=\\d+$`));
    expect(list.body.data.find((b: { id: string }) => b.id === noCover.id).coverUrl).toBeNull();

    const img = await request(app).get(url).responseType("blob");
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
    expect(img.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(img.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.compare(img.body as Buffer, PNG)).toBe(0);
    expect((await request(app).get(`/api/public/libraries/parish/books/${withCover.id}/cover`)).headers["cache-control"]).toBe("no-cache");

    const notFound = [
      `/api/public/libraries/parish/books/${noCover.id}/cover`, // no picture
      `/api/public/libraries/parish/books/${archived.id}/cover`, // archived
      `/api/public/libraries/parish/books/${closedBook.id}/cover`, // another library
      `/api/public/libraries/closed/books/${closedBook.id}/cover`, // form disabled
      `/api/public/libraries/parish/books/nope/cover`,
      `/api/public/libraries/nope/books/${withCover.id}/cover`,
    ];
    for (const path of notFound) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(404);
      expect(res.body.error.code, path).toBe("NOT_FOUND");
    }
  });
});

describe("public request: email", () => {
  it("is required, trimmed, lower-cased and must look like name@host.tld", async () => {
    const lib = await parish();
    const book = await createBook(lib.id);
    const items = [{ bookId: book.id, quantity: 1 }];
    for (const email of [undefined, "", "   ", "juan", "juan@localhost", "juan@example.", "juan@.com", "juan@example.c", "ju an@example.com", `${"a".repeat(250)}@example.com`]) {
      const res = await request(app).post(requestUrl).send({ borrower: { name: "Juan", email }, items });
      expect(res.status, String(email)).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.details.issues[0].path).toEqual(["borrower", "email"]);
    }
    expect(await prisma.borrower.count()).toBe(0);

    const ok = await request(app).post(requestUrl).send({ borrower: { name: "Juan", email: "  Juan.Dela-Cruz+books@School.Edu.PH " }, items });
    expect(ok.status).toBe(201);
    expect(ok.body).toEqual({ loanNumber: "BR-000001", status: "PENDING" });
    const b = await prisma.borrower.findFirstOrThrow();
    expect(b).toMatchObject({ name: "Juan", email: "juan.dela-cruz+books@school.edu.ph", passwordHash: null, mustChangePassword: false });
  });

  it("links the borrower with that email (any capitalisation) without overwriting their details", async () => {
    const lib = await parish();
    const book = await createBook(lib.id);
    const items = [{ bookId: book.id, quantity: 1 }];
    const existing = await prisma.borrower.create({ data: { name: "Maria Clara", email: "maria@example.com", contact: "orig", idNumber: "S-1" } });
    const res = await request(app)
      .post(requestUrl)
      .send({ borrower: { name: "Maria C.", email: "MARIA@example.com", contact: "new", idNumber: "S-999" }, items });
    expect(res.status).toBe(201);
    const loan = await prisma.loan.findFirstOrThrow({ include: { borrower: true } });
    expect(loan.borrowerId).toBe(existing.id);
    expect(loan.borrower).toMatchObject({ name: "Maria Clara", contact: "orig", idNumber: "S-1" });
    expect(loan.submittedName).toBe("Maria C.");
    expect(await prisma.borrower.count()).toBe(1);
  });

  it("an ID number without an email gets this email; an ID number with another email → 409 EMAIL_MISMATCH", async () => {
    const lib = await parish();
    const book = await createBook(lib.id);
    const items = [{ bookId: book.id, quantity: 1 }];
    const noEmail = await prisma.borrower.create({ data: { name: "Jose Rizal", idNumber: "P-1" } });
    await prisma.borrower.create({ data: { name: "Andres Bonifacio", idNumber: "P-2", email: "andres@example.com" } });

    const filled = await request(app).post(requestUrl).send({ borrower: { name: "Jose", email: "jose@example.com", idNumber: "P-1" }, items });
    expect(filled.status).toBe(201);
    expect(await prisma.borrower.findUniqueOrThrow({ where: { id: noEmail.id } })).toMatchObject({ name: "Jose Rizal", email: "jose@example.com" });

    const mismatch = await request(app).post(requestUrl).send({ borrower: { name: "Andres", email: "someone@example.com", idNumber: "P-2" }, items });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error).toEqual({
      code: "EMAIL_MISMATCH",
      message: "This ID number is registered with a different email address. Please use that email or ask the library staff.",
    });
    // The same ID number with its own email is fine.
    expect((await request(app).post(requestUrl).send({ borrower: { name: "Andres", email: "andres@example.com", idNumber: "P-2" }, items })).status).toBe(201);
    expect(await prisma.loan.count()).toBe(2);
    expect(await prisma.borrower.count()).toBe(2);
  });

  it("a new email and a new ID number create one borrower; concurrent requests with one email share it", async () => {
    const lib = await parish();
    const book = await createBook(lib.id, { totalCopies: 5 });
    const items = [{ bookId: book.id, quantity: 1 }];
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        request(app).post(requestUrl).send({ borrower: { name: `Student ${i}`, email: "student@example.com", idNumber: "ID-77" }, items }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(await prisma.borrower.count()).toBe(1);
    expect(await prisma.borrower.findFirstOrThrow()).toMatchObject({ email: "student@example.com", idNumber: "ID-77" });
    expect(await prisma.loan.count()).toBe(5);
  });

  it("the staff can see the email on the request", async () => {
    const lib = await parish();
    const book = await createBook(lib.id);
    await request(app).post(requestUrl).send({ borrower: { name: "Maria Clara", email: "maria@example.com" }, items: [{ bookId: book.id, quantity: 1 }] });
    const { agent } = await loginAs("staff");
    const list = await agent.get("/api/loans?status=PENDING");
    expect(list.body.data[0].borrower).toMatchObject({ name: "Maria Clara", email: "maria@example.com" });
    expect(list.body.data[0].notification).toBeNull();
  });
});
