import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { addDays, todayDateOnly } from "../src/lib/dates.js";
import { createBook, createLibrary, getBook, loginAs, publicRequest, staffLoan } from "./helpers.js";

describe("staff loans (→ BORROWED)", () => {
  it("creates a BORROWED loan, deducts stock and returns LoanDetail", async () => {
    const { agent, user } = await loginAs("STAFF");
    const lib = await createLibrary({ name: "Main", defaultLoanDays: 10 });
    const b1 = await createBook(lib.id, { title: "Book One", totalCopies: 3 });
    const b2 = await createBook(lib.id, { title: "Book Two", totalCopies: 1 });
    const res = await agent.post("/api/loans").send({
      libraryId: lib.id,
      borrower: { name: "Juan", idNumber: "S-1", contact: "", affiliation: "Grade 7" },
      items: [
        { bookId: b1.id, quantity: 2 },
        { bookId: b2.id, quantity: 1 },
      ],
      notes: "  for a report ",
    });
    expect(res.status).toBe(201);
    const loan = res.body;
    expect(loan).toMatchObject({
      number: 1,
      loanNumber: "BR-000001",
      libraryId: lib.id,
      library: { id: lib.id, name: "Main" },
      borrower: { name: "Juan", idNumber: "S-1", contact: null, affiliation: "Grade 7" },
      source: "STAFF",
      status: "BORROWED",
      dueDate: addDays(todayDateOnly(), 10),
      closedAt: null,
      notes: "for a report",
      staffNotes: null,
      submittedName: null,
      totalQuantity: 3,
      outstandingTotal: 3,
      isOverdue: false,
      daysOverdue: 0,
      createdBy: { id: user.id, name: user.name },
      approvedBy: { id: user.id, name: user.name },
      closedBy: null,
      returns: [],
    });
    expect(loan.requestedAt).toBe(loan.borrowedAt);
    expect(loan.items[0]).toEqual({
      id: expect.any(String),
      bookId: b1.id,
      book: { id: b1.id, title: "Book One", author: null, callNumber: null, archived: false },
      quantity: 2,
      returnedGood: 0,
      returnedDamaged: 0,
      lost: 0,
      outstanding: 2,
    });
    expect(await getBook(b1.id)).toMatchObject({ totalCopies: 3, availableCopies: 1 });
    expect(await getBook(b2.id)).toMatchObject({ totalCopies: 1, availableCopies: 0 });
  });

  it("reuses an existing borrower matched by idNumber without overwriting details", async () => {
    const { agent } = await loginAs("STAFF");
    const lib = await createLibrary();
    const book = await createBook(lib.id, { totalCopies: 5 });
    const first = await staffLoan(agent, lib.id, [{ bookId: book.id, quantity: 1 }], { name: "Original Name", idNumber: "ID-9" });
    const second = await staffLoan(agent, lib.id, [{ bookId: book.id, quantity: 1 }], { name: "Different Name", idNumber: "ID-9" });
    expect(second.borrower.id).toBe(first.borrower.id);
    expect(second.borrower.name).toBe("Original Name");
    expect(await prisma.borrower.count()).toBe(1);
  });

  it("insufficient copies → 409 listing the books, nothing changes", async () => {
    const { agent } = await loginAs("STAFF");
    const lib = await createLibrary();
    const ok = await createBook(lib.id, { title: "Plenty", totalCopies: 5 });
    const short = await createBook(lib.id, { title: "Scarce", totalCopies: 1 });
    const res = await agent.post("/api/loans").send({
      libraryId: lib.id,
      borrower: { name: "Juan", idNumber: "NEW-1" },
      items: [
        { bookId: ok.id, quantity: 2 },
        { bookId: short.id, quantity: 2 },
      ],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSUFFICIENT_COPIES");
    expect(res.body.error.details).toEqual({ books: [{ bookId: short.id, title: "Scarce", requested: 2, available: 1 }] });
    expect(await getBook(ok.id)).toMatchObject({ availableCopies: 5 });
    expect(await getBook(short.id)).toMatchObject({ availableCopies: 1 });
    expect(await prisma.loan.count()).toBe(0);
    expect(await prisma.borrower.count()).toBe(0); // borrower creation rolled back too
  });

  it("concurrent borrows of the last copy never oversell", async () => {
    const { agent } = await loginAs("STAFF");
    const lib = await createLibrary();
    const book = await createBook(lib.id, { totalCopies: 1 });
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        agent.post("/api/loans").send({ libraryId: lib.id, borrower: { name: `Borrower ${i}` }, items: [{ bookId: book.id, quantity: 1 }] }),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
    for (const r of results.filter((r) => r.status === 409)) expect(r.body.error.code).toBe("INSUFFICIENT_COPIES");
    expect(await getBook(book.id)).toMatchObject({ totalCopies: 1, availableCopies: 0 });
    expect(await prisma.loan.count()).toBe(1);
  });

  it("concurrent multi-copy borrows never take more than available", async () => {
    const { agent } = await loginAs("STAFF");
    const lib = await createLibrary();
    const a = await createBook(lib.id, { totalCopies: 5 });
    const b = await createBook(lib.id, { totalCopies: 5 });
    // Opposite item orders exercise the lock ordering (no deadlocks).
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        agent.post("/api/loans").send({
          libraryId: lib.id,
          borrower: { name: `Borrower ${i}` },
          items: i % 2 ? [{ bookId: a.id, quantity: 2 }, { bookId: b.id, quantity: 2 }] : [{ bookId: b.id, quantity: 2 }, { bookId: a.id, quantity: 2 }],
        }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    expect(await getBook(a.id)).toMatchObject({ availableCopies: 1 });
    expect(await getBook(b.id)).toMatchObject({ availableCopies: 1 });
  });

  it("rejects archived, other-library and missing books with INVALID_BOOKS", async () => {
    const { agent } = await loginAs("STAFF");
    const lib = await createLibrary();
    const other = await createLibrary();
    const good = await createBook(lib.id, { totalCopies: 2 });
    const archived = await createBook(lib.id, { archived: true });
    const foreign = await createBook(other.id);
    const res = await agent.post("/api/loans").send({
      libraryId: lib.id,
      borrower: { name: "Juan" },
      items: [
        { bookId: good.id, quantity: 1 },
        { bookId: archived.id, quantity: 1 },
        { bookId: foreign.id, quantity: 1 },
        { bookId: "missing", quantity: 1 },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_BOOKS");
    expect(res.body.error.details.bookIds.sort()).toEqual([archived.id, foreign.id, "missing"].sort());
    expect(await getBook(good.id)).toMatchObject({ availableCopies: 2 });
  });

  it("validates borrower choice, items, duplicates and due date", async () => {
    const { agent } = await loginAs("STAFF");
    const lib = await createLibrary();
    const book = await createBook(lib.id, { totalCopies: 2 });
    const base = { libraryId: lib.id, items: [{ bookId: book.id, quantity: 1 }] };
    const neither = await agent.post("/api/loans").send(base);
    expect(neither.status).toBe(400);
    const both = await agent.post("/api/loans").send({ ...base, borrowerId: "x", borrower: { name: "Juan" } });
    expect(both.status).toBe(400);
    const dup = await agent.post("/api/loans").send({ ...base, borrower: { name: "Juan" }, items: [{ bookId: book.id, quantity: 1 }, { bookId: book.id, quantity: 1 }] });
    expect(dup.status).toBe(400);
    expect(dup.body.error.details.issues[0].path).toEqual(["items", 1, "bookId"]);
    const qty = await agent.post("/api/loans").send({ ...base, borrower: { name: "Juan" }, items: [{ bookId: book.id, quantity: 0 }] });
    expect(qty.body.error.details.issues[0].path).toEqual(["items", 0, "quantity"]);
    const past = await agent.post("/api/loans").send({ ...base, borrower: { name: "Juan" }, dueDate: addDays(todayDateOnly(), -1) });
    expect(past.status).toBe(400);
    expect(past.body.error.details.issues[0].path).toEqual(["dueDate"]);
    const badDate = await agent.post("/api/loans").send({ ...base, borrower: { name: "Juan" }, dueDate: "2026-02-30" });
    expect(badDate.status).toBe(400);
    const today = await agent.post("/api/loans").send({ ...base, borrower: { name: "Juan" }, dueDate: todayDateOnly() });
    expect(today.status).toBe(201);
    expect(today.body.dueDate).toBe(todayDateOnly());
    const noBorrower = await agent.post("/api/loans").send({ ...base, borrowerId: "missing" });
    expect(noBorrower.status).toBe(404);
  });
});

describe("pending requests: approve / reject / cancel / edit", () => {
  async function setup() {
    const { agent, user } = await loginAs("STAFF");
    const lib = await createLibrary({ slug: "parish", publicFormEnabled: true, defaultLoanDays: 5 });
    const book = await createBook(lib.id, { title: "Bible", totalCopies: 2 });
    const pending = await publicRequest("parish", [{ bookId: book.id, quantity: 2 }]);
    return { agent, user, lib, book, pending };
  }

  it("approve: PENDING → BORROWED, deducts stock, sets approvedBy and due date", async () => {
    const { agent, user, book, pending } = await setup();
    expect(await getBook(book.id)).toMatchObject({ availableCopies: 2 }); // no reservation while pending
    const res = await agent.post(`/api/loans/${pending.id}/approve`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "BORROWED",
      source: "PUBLIC_FORM",
      dueDate: addDays(todayDateOnly(), 5),
      approvedBy: { id: user.id },
      createdBy: null,
      outstandingTotal: 2,
    });
    expect(res.body.borrowedAt).not.toBeNull();
    expect(await getBook(book.id)).toMatchObject({ availableCopies: 0 });
    const again = await agent.post(`/api/loans/${pending.id}/approve`).send({});
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: "INVALID_STATUS", details: { status: "BORROWED" } });
  });

  it("concurrent double approve applies once", async () => {
    const { agent, book, pending } = await setup();
    const results = await Promise.all([1, 2, 3].map(() => agent.post(`/api/loans/${pending.id}/approve`).send({})));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    expect(await getBook(book.id)).toMatchObject({ availableCopies: 0 });
  });

  it("approve with insufficient copies → 409 and the loan stays PENDING; staff can reduce items and approve", async () => {
    const { agent, lib, book, pending } = await setup();
    await staffLoan(agent, lib.id, [{ bookId: book.id, quantity: 1 }]);
    const res = await agent.post(`/api/loans/${pending.id}/approve`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSUFFICIENT_COPIES");
    expect((await prisma.loan.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("PENDING");
    const edit = await agent.patch(`/api/loans/${pending.id}`).send({ items: [{ bookId: book.id, quantity: 1 }] });
    expect(edit.status).toBe(200);
    expect(edit.body.totalQuantity).toBe(1);
    const due = addDays(todayDateOnly(), 3);
    const ok = await agent.post(`/api/loans/${pending.id}/approve`).send({ dueDate: due });
    expect(ok.status).toBe(200);
    expect(ok.body.dueDate).toBe(due);
    expect(await getBook(book.id)).toMatchObject({ availableCopies: 0 });
  });

  it("approve with an archived book → 400 INVALID_BOOKS", async () => {
    const { agent, book, pending } = await setup();
    await prisma.book.update({ where: { id: book.id }, data: { archived: true } });
    const res = await agent.post(`/api/loans/${pending.id}/approve`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: "INVALID_BOOKS", details: { bookIds: [book.id] } });
    expect((await prisma.loan.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("PENDING");
    expect(await getBook(book.id)).toMatchObject({ availableCopies: 2 });
  });

  it("item edits may keep a line whose book was archived after the request, but not add archived books", async () => {
    const { agent, lib } = await setup();
    const kept = await createBook(lib.id, { title: "Kept", totalCopies: 3 });
    const other = await createBook(lib.id, { title: "Other", totalCopies: 3 });
    const pending = await publicRequest("parish", [
      { bookId: kept.id, quantity: 1 },
      { bookId: other.id, quantity: 2 },
    ]);
    await prisma.book.update({ where: { id: kept.id }, data: { archived: true } });

    // Changing another line while the archived line stays is allowed (it only blocks approval).
    const edit = await agent.patch(`/api/loans/${pending.id}`).send({
      items: [
        { bookId: kept.id, quantity: 1 },
        { bookId: other.id, quantity: 1 },
      ],
    });
    expect(edit.status).toBe(200);
    expect(edit.body.items.map((i: { bookId: string; quantity: number }) => [i.bookId, i.quantity]).sort()).toEqual(
      [
        [kept.id, 1],
        [other.id, 1],
      ].sort(),
    );
    const approve = await agent.post(`/api/loans/${pending.id}/approve`).send({});
    expect(approve.body.error).toMatchObject({ code: "INVALID_BOOKS", details: { bookIds: [kept.id] } });

    // Adding a different archived book is still rejected, listing only that book.
    const newlyArchived = await createBook(lib.id, { archived: true });
    const add = await agent.patch(`/api/loans/${pending.id}`).send({
      items: [
        { bookId: kept.id, quantity: 1 },
        { bookId: newlyArchived.id, quantity: 1 },
      ],
    });
    expect(add.status).toBe(400);
    expect(add.body.error).toMatchObject({ code: "INVALID_BOOKS", details: { bookIds: [newlyArchived.id] } });

    // Once removed, an archived line cannot be added back.
    expect((await agent.patch(`/api/loans/${pending.id}`).send({ items: [{ bookId: other.id, quantity: 1 }] })).status).toBe(200);
    const readd = await agent.patch(`/api/loans/${pending.id}`).send({ items: [{ bookId: kept.id, quantity: 1 }] });
    expect(readd.body.error).toMatchObject({ code: "INVALID_BOOKS", details: { bookIds: [kept.id] } });
    expect((await agent.post(`/api/loans/${pending.id}/approve`).send({})).status).toBe(200);
  });

  it("reject requires a reason and closes the request", async () => {
    const { agent, user, pending } = await setup();
    expect((await agent.post(`/api/loans/${pending.id}/reject`).send({})).status).toBe(400);
    const res = await agent.post(`/api/loans/${pending.id}/reject`).send({ reason: "Not a parishioner" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "REJECTED", staffNotes: "Not a parishioner", closedBy: { id: user.id }, outstandingTotal: 0 });
    expect(res.body.closedAt).not.toBeNull();
    for (const action of ["approve", "cancel", "reject"]) {
      const r = await agent.post(`/api/loans/${pending.id}/${action}`).send({ reason: "x" });
      expect(r.status, action).toBe(409);
      expect(r.body.error.code).toBe("INVALID_STATUS");
    }
    const ret = await agent.post(`/api/loans/${pending.id}/returns`).send({ items: [] });
    expect([400, 409]).toContain(ret.status);
  });

  it("cancel works without a reason; invalid transitions are 409", async () => {
    const { agent, pending } = await setup();
    const res = await agent.post(`/api/loans/${pending.id}/cancel`).send({});
    expect(res.body).toMatchObject({ status: "CANCELLED", staffNotes: null });
    const approve = await agent.post(`/api/loans/${pending.id}/approve`).send({});
    expect(approve.status).toBe(409);
    expect(approve.body.error.details).toEqual({ status: "CANCELLED" });
    expect((await agent.post("/api/loans/missing/approve").send({})).status).toBe(404);
  });

  it("returns against a PENDING loan → 409 INVALID_STATUS", async () => {
    const { agent, pending } = await setup();
    const item = await prisma.loanItem.findFirstOrThrow({ where: { loanId: pending.id } });
    const res = await agent.post(`/api/loans/${pending.id}/returns`).send({ items: [{ loanItemId: item.id, good: 1 }] });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "INVALID_STATUS", details: { status: "PENDING" } });
  });

  it("PATCH rules: items only while PENDING, dueDate only while open, notes until closed", async () => {
    const { agent, lib, book, pending } = await setup();
    const dueOnPending = await agent.patch(`/api/loans/${pending.id}`).send({ dueDate: addDays(todayDateOnly(), 3) });
    expect(dueOnPending.status).toBe(409);
    const notes = await agent.patch(`/api/loans/${pending.id}`).send({ notes: "Call first" });
    expect(notes.body.notes).toBe("Call first");
    const archived = await createBook(lib.id, { archived: true });
    const badItems = await agent.patch(`/api/loans/${pending.id}`).send({ items: [{ bookId: archived.id, quantity: 1 }] });
    expect(badItems.status).toBe(400);
    expect(badItems.body.error.code).toBe("INVALID_BOOKS");

    const loan = await staffLoan(agent, lib.id, [{ bookId: book.id, quantity: 1 }]);
    const items = await agent.patch(`/api/loans/${loan.id}`).send({ items: [{ bookId: book.id, quantity: 2 }] });
    expect(items.status).toBe(409);
    expect(items.body.error.code).toBe("INVALID_STATUS");
    const extended = addDays(todayDateOnly(), 30);
    const extend = await agent.patch(`/api/loans/${loan.id}`).send({ dueDate: extended, notes: null });
    expect(extend.status).toBe(200);
    expect(extend.body).toMatchObject({ dueDate: extended, notes: null });
    const pastDue = await agent.patch(`/api/loans/${loan.id}`).send({ dueDate: addDays(todayDateOnly(), -1) });
    expect(pastDue.status).toBe(400);

    await agent.post(`/api/loans/${loan.id}/returns`).send({ items: [{ loanItemId: loan.items[0].id, good: 1 }] });
    const closedNotes = await agent.patch(`/api/loans/${loan.id}`).send({ notes: "late" });
    expect(closedNotes.status).toBe(409);
  });
});

describe("returns", () => {
  async function borrowed(totalCopies = 5, quantity = 3) {
    const { agent, user } = await loginAs("STAFF");
    const lib = await createLibrary();
    const book = await createBook(lib.id, { totalCopies });
    const other = await createBook(lib.id, { totalCopies: 2 });
    const loan = await staffLoan(agent, lib.id, [
      { bookId: book.id, quantity },
      { bookId: other.id, quantity: 1 },
    ]);
    return { agent, user, lib, book, other, loan, itemId: loan.items[0].id as string, otherItemId: loan.items[1].id as string };
  }

  it("partial return → PARTIALLY_RETURNED, stock back, record kept", async () => {
    const { agent, user, book, loan, itemId } = await borrowed();
    const res = await agent.post(`/api/loans/${loan.id}/returns`).send({
      items: [{ loanItemId: itemId, good: 1, damaged: 1, lost: 0 }],
      returnedByName: "Her brother",
      notes: "cover torn",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "PARTIALLY_RETURNED", outstandingTotal: 2, closedAt: null, closedBy: null });
    expect(res.body.items[0]).toMatchObject({ returnedGood: 1, returnedDamaged: 1, lost: 0, outstanding: 1 });
    expect(res.body.returns).toEqual([
      {
        id: expect.any(String),
        receivedAt: expect.any(String),
        receivedBy: { id: user.id, name: user.name },
        returnedByName: "Her brother",
        notes: "cover torn",
        items: [{ id: expect.any(String), loanItemId: itemId, bookId: book.id, bookTitle: book.title, good: 1, damaged: 1, lost: 0 }],
      },
    ]);
    expect(await getBook(book.id)).toMatchObject({ totalCopies: 5, availableCopies: 4 });
  });

  it("completing all items (with a lost copy) → RETURNED; lost reduces totalCopies", async () => {
    const { agent, user, book, other, loan, itemId, otherItemId } = await borrowed();
    await agent.post(`/api/loans/${loan.id}/returns`).send({ items: [{ loanItemId: itemId, good: 2 }] });
    const res = await agent.post(`/api/loans/${loan.id}/returns`).send({
      items: [
        { loanItemId: itemId, lost: 1 },
        { loanItemId: otherItemId, good: 1 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "RETURNED", outstandingTotal: 0, closedBy: { id: user.id }, isOverdue: false });
    expect(res.body.closedAt).not.toBeNull();
    expect(res.body.returns).toHaveLength(2);
    expect(await getBook(book.id)).toMatchObject({ totalCopies: 4, availableCopies: 4 });
    expect(await getBook(other.id)).toMatchObject({ totalCopies: 2, availableCopies: 2 });
    const more = await agent.post(`/api/loans/${loan.id}/returns`).send({ items: [{ loanItemId: itemId, good: 1 }] });
    expect(more.status).toBe(409);
    expect(more.body.error.code).toBe("INVALID_STATUS");
  });

  it("over-return → 400 RETURN_EXCEEDS_OUTSTANDING, nothing applied", async () => {
    const { agent, book, loan, itemId, otherItemId } = await borrowed();
    const res = await agent.post(`/api/loans/${loan.id}/returns`).send({
      items: [
        { loanItemId: itemId, good: 2, damaged: 2 },
        { loanItemId: otherItemId, good: 1 },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: "RETURN_EXCEEDS_OUTSTANDING", details: { loanItemIds: [itemId] } });
    expect(await getBook(book.id)).toMatchObject({ availableCopies: 2 });
    expect(await prisma.returnRecord.count()).toBe(0);
  });

  it("validates items: zero total, duplicates, foreign items, negatives", async () => {
    const { agent, lib, loan, itemId } = await borrowed();
    const zero = await agent.post(`/api/loans/${loan.id}/returns`).send({ items: [{ loanItemId: itemId, good: 0, damaged: 0, lost: 0 }] });
    expect(zero.status).toBe(400);
    expect(zero.body.error.code).toBe("VALIDATION_ERROR");
    const dup = await agent.post(`/api/loans/${loan.id}/returns`).send({ items: [{ loanItemId: itemId, good: 1 }, { loanItemId: itemId, good: 1 }] });
    expect(dup.status).toBe(400);
    expect(dup.body.error.code).toBe("VALIDATION_ERROR");
    const otherBook = await createBook(lib.id, { totalCopies: 1 });
    const otherLoan = await staffLoan(agent, lib.id, [{ bookId: otherBook.id, quantity: 1 }]);
    const foreign = await agent.post(`/api/loans/${loan.id}/returns`).send({ items: [{ loanItemId: otherLoan.items[0].id, good: 1 }] });
    expect(foreign.status).toBe(400);
    expect(foreign.body.error.code).toBe("VALIDATION_ERROR");
    const neg = await agent.post(`/api/loans/${loan.id}/returns`).send({ items: [{ loanItemId: itemId, good: -1 }] });
    expect(neg.status).toBe(400);
    expect(await prisma.returnRecord.count()).toBe(0);
  });

  it("a double-submitted return check applies only once", async () => {
    const { agent, book, loan, itemId } = await borrowed(3, 3);
    const body = { items: [{ loanItemId: itemId, good: 3 }] };
    const results = await Promise.all([1, 2, 3].map(() => agent.post(`/api/loans/${loan.id}/returns`).send(body)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    for (const r of results.filter((r) => r.status !== 200)) {
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe("RETURN_EXCEEDS_OUTSTANDING");
    }
    expect(await getBook(book.id)).toMatchObject({ totalCopies: 3, availableCopies: 3 });
    expect(await prisma.returnRecord.count()).toBe(1);
  });
});

describe("loan list", () => {
  it("filters by status list, library, borrower, book, q (name / id / loan number) and sorts newest first", async () => {
    const { agent } = await loginAs("STAFF");
    const lib = await createLibrary({ slug: "lib-a", publicFormEnabled: true });
    const other = await createLibrary();
    const book = await createBook(lib.id, { totalCopies: 10 });
    const book2 = await createBook(lib.id, { totalCopies: 10 });
    const otherBook = await createBook(other.id, { totalCopies: 10 });
    const l1 = await staffLoan(agent, lib.id, [{ bookId: book.id, quantity: 1 }], { name: "Alice Reyes", idNumber: "A-100" });
    const l2 = await staffLoan(agent, lib.id, [{ bookId: book2.id, quantity: 1 }], { name: "Bob Cruz" });
    const pending = await publicRequest("lib-a", [{ bookId: book.id, quantity: 1 }], { name: "Carla" });
    const l4 = await staffLoan(agent, other.id, [{ bookId: otherBook.id, quantity: 1 }], { name: "Dan" });
    await agent.post(`/api/loans/${l2.id}/returns`).send({ items: [{ loanItemId: l2.items[0].id, good: 1 }] });

    const all = await agent.get("/api/loans");
    expect(all.body.total).toBe(4);
    expect(all.body.data.map((l: { id: string }) => l.id)).toEqual([l4.id, pending.id, l2.id, l1.id]);
    const active = await agent.get("/api/loans?status=BORROWED,PARTIALLY_RETURNED");
    expect(active.body.data.map((l: { id: string }) => l.id)).toEqual([l4.id, l1.id]);
    expect((await agent.get("/api/loans?status=PENDING")).body.data[0].id).toBe(pending.id);
    expect((await agent.get("/api/loans?status=NOPE")).status).toBe(400);
    expect((await agent.get(`/api/loans?libraryId=${other.id}`)).body.total).toBe(1);
    expect((await agent.get(`/api/loans?borrowerId=${l1.borrower.id}`)).body.data[0].id).toBe(l1.id);
    expect((await agent.get(`/api/loans?bookId=${book.id}`)).body.total).toBe(2);
    expect((await agent.get("/api/loans?q=alice")).body.data[0].id).toBe(l1.id);
    expect((await agent.get("/api/loans?q=a-10")).body.data[0].id).toBe(l1.id);
    // search accepts the BR- reference number, the old LN- form and a bare number
    for (const q of ["BR-000002", "br-2", "BR2", "LN-000002", "ln-2", "2", "000002"]) {
      const r = await agent.get(`/api/loans?q=${q}`);
      expect(r.body.data.map((l: { id: string }) => l.id), q).toContain(l2.id);
    }
    expect((await agent.get("/api/loans?overdue=true")).body.total).toBe(0);
    const paged = await agent.get("/api/loans?pageSize=1&page=2");
    expect(paged.body).toMatchObject({ total: 4, page: 2, pageSize: 1 });
    expect(paged.body.data[0].id).toBe(pending.id);
    // PENDING loans have no outstanding copies
    const p = (await agent.get(`/api/loans/${pending.id}`)).body;
    expect(p).toMatchObject({ status: "PENDING", outstandingTotal: 0, dueDate: null, borrowedAt: null, submittedName: "Carla" });
    expect(p.items[0].outstanding).toBe(0);
  });
});
