import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { createBook, createLibrary, getBook, loginAs, staffLoan } from "./helpers.js";

describe("libraries", () => {
  it("creates with generated unique slugs and returns the Library shape", async () => {
    const { agent } = await loginAs("all");
    const a = await agent.post("/api/libraries").send({ name: "  Main Library  ", description: "", location: "Bldg A" });
    expect(a.status).toBe(201);
    expect(a.body).toEqual({
      id: expect.any(String),
      name: "Main Library",
      slug: "main-library",
      description: null,
      location: "Bldg A",
      publicFormEnabled: false,
      defaultLoanDays: 7,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      counts: { books: 0, copies: 0, available: 0, activeLoans: 0, pendingRequests: 0, categories: 0 },
    });
    const b = await agent.post("/api/libraries").send({ name: "Main Library" });
    expect(b.body.slug).toBe("main-library-2");
    const c = await agent.post("/api/libraries").send({ name: "Main Library" });
    expect(c.body.slug).toBe("main-library-3");
    const short = await agent.post("/api/libraries").send({ name: "Ñ" });
    expect(short.body.slug).toMatch(/^[a-z0-9-]{3,60}$/);
  });

  it("validates slug and rejects duplicates with SLUG_TAKEN", async () => {
    const { agent } = await loginAs("all");
    const bad = await agent.post("/api/libraries").send({ name: "X", slug: "a b" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.issues[0].path).toEqual(["slug"]);
    await agent.post("/api/libraries").send({ name: "One", slug: "parish-lib" });
    const dup = await agent.post("/api/libraries").send({ name: "Two", slug: "parish-lib" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("SLUG_TAKEN");
    const two = await agent.post("/api/libraries").send({ name: "Two", slug: "two-lib" });
    const patch = await agent.patch(`/api/libraries/${two.body.id}`).send({ slug: "parish-lib" });
    expect(patch.status).toBe(409);
    expect(patch.body.error.code).toBe("SLUG_TAKEN");
    const days = await agent.post("/api/libraries").send({ name: "Three", defaultLoanDays: 0 });
    expect(days.status).toBe(400);
  });

  it("lists sorted by name with counts, patches, and 404s unknown ids", async () => {
    const { agent } = await loginAs("all");
    const lib = await createLibrary({ name: "Zeta" });
    await createLibrary({ name: "Alpha" });
    await createBook(lib.id, { totalCopies: 3 });
    await createBook(lib.id, { totalCopies: 2, archived: true });
    await prisma.category.create({ data: { libraryId: lib.id, name: "Fiction" } });
    const list = await agent.get("/api/libraries");
    expect(list.body.data.map((l: { name: string }) => l.name)).toEqual(["Alpha", "Zeta"]);
    expect(list.body.data[1].counts).toEqual({ books: 1, copies: 3, available: 3, activeLoans: 0, pendingRequests: 0, categories: 1 });
    const patched = await agent.patch(`/api/libraries/${lib.id}`).send({ publicFormEnabled: true, description: "Hi", location: null });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ publicFormEnabled: true, description: "Hi", location: null, name: "Zeta" });
    expect((await agent.get("/api/libraries/nope")).status).toBe(404);
  });

  it("deletes only empty libraries (categories cascade)", async () => {
    const { agent } = await loginAs("all");
    const empty = await createLibrary();
    await prisma.category.create({ data: { libraryId: empty.id, name: "Fiction" } });
    const del = await agent.delete(`/api/libraries/${empty.id}`).send({});
    expect(del.status).toBe(204);
    expect(await prisma.category.count()).toBe(0);

    const withArchived = await createLibrary();
    await createBook(withArchived.id, { archived: true });
    const res = await agent.delete(`/api/libraries/${withArchived.id}`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("LIBRARY_NOT_EMPTY");
  });
});

describe("categories", () => {
  it("CRUD with case-insensitive uniqueness per library and bookCount of non-archived books", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary();
    const other = await createLibrary();
    const c = await agent.post(`/api/libraries/${lib.id}/categories`).send({ name: " Filipiniana ", description: "" });
    expect(c.status).toBe(201);
    expect(c.body).toEqual({ id: expect.any(String), libraryId: lib.id, name: "Filipiniana", description: null, bookCount: 0 });
    const dup = await agent.post(`/api/libraries/${lib.id}/categories`).send({ name: "FILIPINIANA" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("CATEGORY_EXISTS");
    expect((await agent.post(`/api/libraries/${other.id}/categories`).send({ name: "Filipiniana" })).status).toBe(201);

    const fic = await agent.post(`/api/libraries/${lib.id}/categories`).send({ name: "Fiction" });
    const rename = await agent.patch(`/api/categories/${fic.body.id}`).send({ name: "filipiniana" });
    expect(rename.body.error.code).toBe("CATEGORY_EXISTS");
    const ok = await agent.patch(`/api/categories/${fic.body.id}`).send({ name: "Fiction & Novels", description: "Stories" });
    expect(ok.body).toMatchObject({ name: "Fiction & Novels", description: "Stories" });

    await createBook(lib.id, { categoryId: c.body.id });
    await createBook(lib.id, { categoryId: c.body.id, archived: true });
    const list = await agent.get(`/api/libraries/${lib.id}/categories`);
    expect(list.body.data.map((x: { name: string; bookCount: number }) => [x.name, x.bookCount])).toEqual([
      ["Fiction & Novels", 0],
      ["Filipiniana", 1],
    ]);
    expect((await agent.get("/api/libraries/nope/categories")).status).toBe(404);
  });

  it("case-insensitive name matching treats _ and % literally", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary();
    expect((await agent.post(`/api/libraries/${lib.id}/categories`).send({ name: "A_b" })).status).toBe(201);
    expect((await agent.post(`/api/libraries/${lib.id}/categories`).send({ name: "Axb" })).status).toBe(201);
    expect((await agent.post(`/api/libraries/${lib.id}/categories`).send({ name: "100%" })).status).toBe(201);
    expect((await agent.post(`/api/libraries/${lib.id}/categories`).send({ name: "1000" })).status).toBe(201);
    const bulk = await agent.post("/api/books/bulk").send({ libraryId: lib.id, books: [{ title: "T", categoryName: "a_B" }, { title: "U", categoryName: "1%" }] });
    expect(bulk.body).toEqual({ created: 2, categoriesCreated: ["1%"] });
    const t = await prisma.book.findFirstOrThrow({ where: { title: "T" }, include: { category: true } });
    expect(t.category?.name).toBe("A_b");
  });

  it("deleting a category keeps its books (categoryId→ null)", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary();
    const cat = await prisma.category.create({ data: { libraryId: lib.id, name: "Reference" } });
    const book = await createBook(lib.id, { categoryId: cat.id });
    expect((await agent.delete(`/api/categories/${cat.id}`).send({})).status).toBe(204);
    expect((await getBook(book.id)).categoryId).toBeNull();
  });
});

describe("books", () => {
  it("creates a book (available = total) and returns the Book shape", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary({ name: "Main" });
    const res = await agent.post("/api/books").send({
      libraryId: lib.id,
      title: " Noli Me Tangere ",
      author: "José Rizal",
      isbn: "",
      publicationYear: 1887,
      totalCopies: 3,
      categoryName: "Filipiniana",
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      libraryId: lib.id,
      library: { id: lib.id, name: "Main" },
      categoryId: expect.any(String),
      category: { id: expect.any(String), name: "Filipiniana" },
      title: "Noli Me Tangere",
      author: "José Rizal",
      isbn: null,
      publisher: null,
      publicationYear: 1887,
      callNumber: null,
      totalCopies: 3,
      availableCopies: 3,
      onLoan: 0,
      notes: null,
      archived: false,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      coverUrl: null,
    });
    // categoryName matches case-insensitively instead of creating a duplicate
    const again = await agent.post("/api/books").send({ libraryId: lib.id, title: "El Fili", categoryName: "filipiniana" });
    expect(again.body.categoryId).toBe(res.body.categoryId);
    expect(await prisma.category.count()).toBe(1);
  });

  it("validates input and category ownership", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary();
    const other = await createLibrary();
    const foreignCat = await prisma.category.create({ data: { libraryId: other.id, name: "X" } });
    const bad = await agent.post("/api/books").send({ libraryId: lib.id, title: "", totalCopies: 0, publicationYear: 99 });
    expect(bad.status).toBe(400);
    const paths = bad.body.error.details.issues.map((i: { path: string[] }) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["title", "totalCopies", "publicationYear"]));
    const cat = await agent.post("/api/books").send({ libraryId: lib.id, title: "T", categoryId: foreignCat.id });
    expect(cat.status).toBe(400);
    expect(cat.body.error.code).toBe("INVALID_CATEGORY");
    const both = await agent.post("/api/books").send({ libraryId: lib.id, title: "T", categoryId: foreignCat.id, categoryName: "Y" });
    expect(both.status).toBe(400);
    expect(both.body.error.code).toBe("VALIDATION_ERROR");
    const noLib = await agent.post("/api/books").send({ libraryId: "missing", title: "T" });
    expect(noLib.status).toBe(404);
  });

  it("lists with filters, search, sorting and pagination", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary();
    const other = await createLibrary();
    const cat = await prisma.category.create({ data: { libraryId: lib.id, name: "Fiction" } });
    await createBook(lib.id, { title: "Charlie", categoryId: cat.id });
    await createBook(lib.id, { title: "alpha" });
    const bravo = await createBook(lib.id, { title: "Bravo" });
    await createBook(lib.id, { title: "Archived", archived: true });
    await createBook(other.id, { title: "Elsewhere" });
    await prisma.book.update({ where: { id: bravo.id }, data: { availableCopies: 0 } });

    const all = await agent.get(`/api/books?libraryId=${lib.id}`);
    expect(all.body.total).toBe(3);
    expect(all.body.data.map((b: { title: string }) => b.title)).toEqual(["alpha", "Bravo", "Charlie"]);
    expect(all.body).toMatchObject({ page: 1, pageSize: 20 });
    const arch = await agent.get(`/api/books?libraryId=${lib.id}&includeArchived=true`);
    expect(arch.body.total).toBe(4);
    const avail = await agent.get(`/api/books?libraryId=${lib.id}&available=true`);
    expect(avail.body.data.map((b: { title: string }) => b.title)).toEqual(["alpha", "Charlie"]);
    const byCat = await agent.get(`/api/books?categoryId=${cat.id}`);
    expect(byCat.body.total).toBe(1);
    const q = await agent.get("/api/books?q=CHAR");
    expect(q.body.data[0].title).toBe("Charlie");
    const page2 = await agent.get(`/api/books?libraryId=${lib.id}&page=2&pageSize=2`);
    expect(page2.body.data.map((b: { title: string }) => b.title)).toEqual(["Charlie"]);
    const past = await agent.get(`/api/books?libraryId=${lib.id}&page=9`);
    expect(past.body).toMatchObject({ data: [], total: 3, page: 9 });
    expect((await agent.get("/api/books?pageSize=101")).status).toBe(400);
    expect((await agent.get("/api/books?page=0")).status).toBe(400);
    expect((await agent.get("/api/books?available=yes")).status).toBe(400);
  });

  it("PATCH totalCopies adjusts available and refuses below copies on loan (COPIES_IN_USE)", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary();
    const book = await createBook(lib.id, { totalCopies: 5 });
    await staffLoan(agent, lib.id, [{ bookId: book.id, quantity: 3 }]);
    const up = await agent.patch(`/api/books/${book.id}`).send({ totalCopies: 7 });
    expect(up.status).toBe(200);
    expect(up.body).toMatchObject({ totalCopies: 7, availableCopies: 4, onLoan: 3 });
    const tooLow = await agent.patch(`/api/books/${book.id}`).send({ totalCopies: 2, title: "Changed" });
    expect(tooLow.status).toBe(409);
    expect(tooLow.body.error.code).toBe("COPIES_IN_USE");
    expect(await getBook(book.id)).toMatchObject({ totalCopies: 7, availableCopies: 4, title: book.title }); // nothing changed
    const exact = await agent.patch(`/api/books/${book.id}`).send({ totalCopies: 3 });
    expect(exact.body).toMatchObject({ totalCopies: 3, availableCopies: 0 });
    const clear = await agent.patch(`/api/books/${book.id}`).send({ author: "Someone", notes: "" });
    expect(clear.body).toMatchObject({ author: "Someone", notes: null });
    const libChange = await agent.patch(`/api/books/${book.id}`).send({ libraryId: "x" });
    expect(libChange.status).toBe(200);
    expect(libChange.body.libraryId).toBe(lib.id);
  });

  it("archive is always allowed; delete only for books never loaned (BOOK_HAS_LOANS)", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary();
    const loaned = await createBook(lib.id, { totalCopies: 2 });
    const fresh = await createBook(lib.id);
    await staffLoan(agent, lib.id, [{ bookId: loaned.id, quantity: 1 }]);
    const del = await agent.delete(`/api/books/${loaned.id}`).send({});
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe("BOOK_HAS_LOANS");
    const arch = await agent.patch(`/api/books/${loaned.id}`).send({ archived: true });
    expect(arch.body.archived).toBe(true);
    expect((await agent.delete(`/api/books/${fresh.id}`).send({})).status).toBe(204);
    expect((await agent.get(`/api/books/${fresh.id}`)).status).toBe(404);
  });

  it("bulk add creates all rows and missing categories", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary();
    await prisma.category.create({ data: { libraryId: lib.id, name: "Fiction" } });
    const res = await agent.post("/api/books/bulk").send({
      libraryId: lib.id,
      books: [
        { title: "A", categoryName: "fiction", totalCopies: 2 },
        { title: "B", categoryName: "Reference" },
        { title: "C", categoryName: "REFERENCE", publicationYear: 2001 },
        { title: "D" },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ created: 4, categoriesCreated: ["Reference"] });
    expect(await prisma.category.count({ where: { libraryId: lib.id } })).toBe(2);
    const a = await prisma.book.findFirstOrThrow({ where: { title: "A" } });
    expect(a).toMatchObject({ totalCopies: 2, availableCopies: 2 });
  });

  it("bulk add is all-or-nothing with row paths in validation errors", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary();
    const res = await agent.post("/api/books/bulk").send({
      libraryId: lib.id,
      books: [{ title: "Good", categoryName: "New Cat" }, { title: "Also good" }, { title: "", totalCopies: 0 }, { title: "Year", publicationYear: 12 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    const paths = res.body.error.details.issues.map((i: { path: unknown[] }) => i.path);
    expect(paths).toEqual(expect.arrayContaining([["books", 2, "title"], ["books", 2, "totalCopies"], ["books", 3, "publicationYear"]]));
    expect(await prisma.book.count()).toBe(0);
    expect(await prisma.category.count()).toBe(0);

    const other = await createLibrary();
    const foreign = await prisma.category.create({ data: { libraryId: other.id, name: "Foreign" } });
    const late = await agent.post("/api/books/bulk").send({
      libraryId: lib.id,
      books: [{ title: "First", categoryName: "Created then rolled back" }, { title: "Second", categoryId: foreign.id }],
    });
    expect(late.status).toBe(400);
    expect(late.body.error.code).toBe("INVALID_CATEGORY");
    expect(await prisma.book.count()).toBe(0);
    expect(await prisma.category.count({ where: { libraryId: lib.id } })).toBe(0);

    expect((await agent.post("/api/books/bulk").send({ libraryId: lib.id, books: [] })).status).toBe(400);
  });

  it("bulk add accepts 500 full rows (>100kb body); other endpoints keep the 100kb limit", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary();
    const books = Array.from({ length: 500 }, (_, i) => ({
      title: `Noli Me Tangere (Touch Me Not) — annotated edition volume ${i}`,
      author: "José Protasio Rizal Mercado y Alonso Realonda",
      isbn: "9789710810736",
      publisher: "National Historical Commission of the Philippines",
      publicationYear: 1887,
      callNumber: `PQ8897.R5 N6 1887 c.${i}`,
      totalCopies: 3,
      categoryName: i % 2 ? "Filipiniana" : "Literature",
    }));
    expect(JSON.stringify({ libraryId: lib.id, books }).length).toBeGreaterThan(100 * 1024);
    const res = await agent.post("/api/books/bulk").send({ libraryId: lib.id, books });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(500);
    expect(res.body.categoriesCreated.sort()).toEqual(["Filipiniana", "Literature"]);
    const tooBig = await agent.post("/api/books").send({ libraryId: lib.id, title: "x", notes: "y".repeat(110 * 1024) });
    expect(tooBig.status).toBe(413);
    const tooMany = await agent.post("/api/books/bulk").send({ libraryId: lib.id, books: Array.from({ length: 501 }, () => ({ title: "t" })) });
    expect(tooMany.status).toBe(400);
  });

  it("book detail lists current loans with outstanding copies, oldest due first", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary();
    const book = await createBook(lib.id, { totalCopies: 5 });
    const l1 = await staffLoan(agent, lib.id, [{ bookId: book.id, quantity: 2 }], { name: "Ana" });
    const l2 = await agent.post("/api/loans").send({ libraryId: lib.id, borrower: { name: "Ben" }, items: [{ bookId: book.id, quantity: 1 }], dueDate: "2099-01-01" });
    await agent.post(`/api/loans/${l1.id}/returns`).send({ items: [{ loanItemId: l1.items[0].id, good: 1 }] });
    const res = await agent.get(`/api/books/${book.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ totalCopies: 5, availableCopies: 3, onLoan: 2 });
    expect(res.body.currentLoans).toEqual([
      { loanId: l1.id, loanNumber: l1.loanNumber, status: "PARTIALLY_RETURNED", borrower: { id: l1.borrower.id, name: "Ana" }, quantity: 2, outstanding: 1, dueDate: l1.dueDate, isOverdue: false },
      { loanId: l2.body.id, loanNumber: l2.body.loanNumber, status: "BORROWED", borrower: { id: l2.body.borrower.id, name: "Ben" }, quantity: 1, outstanding: 1, dueDate: "2099-01-01", isOverdue: false },
    ]);
  });
});

describe("borrowers", () => {
  it("CRUD, search, duplicate idNumber and delete rules", async () => {
    const { agent } = await loginAs("staff");
    const a = await agent.post("/api/borrowers").send({ name: " Juan Dela Cruz ", idNumber: " 2024-001 ", contact: "", affiliation: "Grade 10" });
    expect(a.status).toBe(201);
    expect(a.body).toEqual({
      id: expect.any(String),
      name: "Juan Dela Cruz",
      email: null,
      hasAccount: false,
      mustChangePassword: false,
      account: null,
      idNumber: "2024-001",
      contact: null,
      affiliation: "Grade 10",
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      activeLoans: 0,
      outstandingCopies: 0,
    });
    const dup = await agent.post("/api/borrowers").send({ name: "Other", idNumber: "2024-001" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("ID_NUMBER_TAKEN");
    const b = await agent.post("/api/borrowers").send({ name: "Ana Santos", contact: "0917 555 0000" });
    const dupPatch = await agent.patch(`/api/borrowers/${b.body.id}`).send({ idNumber: "2024-001" });
    expect(dupPatch.body.error.code).toBe("ID_NUMBER_TAKEN");
    expect((await agent.post("/api/borrowers").send({ name: "J" })).status).toBe(400);

    const list = await agent.get("/api/borrowers");
    expect(list.body.data.map((x: { name: string }) => x.name)).toEqual(["Ana Santos", "Juan Dela Cruz"]);
    expect((await agent.get("/api/borrowers?q=0917")).body.total).toBe(1);
    expect((await agent.get("/api/borrowers?q=2024-0")).body.data[0].name).toBe("Juan Dela Cruz");

    const lib = await createLibrary();
    const book = await createBook(lib.id, { totalCopies: 3 });
    await agent.post("/api/loans").send({ libraryId: lib.id, borrowerId: a.body.id, items: [{ bookId: book.id, quantity: 2 }] });
    const detail = await agent.get(`/api/borrowers/${a.body.id}`);
    expect(detail.body).toMatchObject({ activeLoans: 1, outstandingCopies: 2 });
    expect(detail.body.loans).toHaveLength(1);
    const del = await agent.delete(`/api/borrowers/${a.body.id}`).send({});
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe("BORROWER_HAS_LOANS");
    expect((await agent.delete(`/api/borrowers/${b.body.id}`).send({})).status).toBe(204);
  });
});
