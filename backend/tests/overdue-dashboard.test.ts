import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { currentMonthRange, dateOnlyToDate, todayDateOnly, zonedStartOfDay } from "../src/lib/dates.js";
import { formatLoanNumber, parseLoanNumber } from "../src/lib/loan-number.js";
import { createBook, createLibrary, loginAs, publicRequest, staffLoan } from "./helpers.js";

afterEach(() => {
  vi.useRealTimers();
});

/** Freeze only Date (network/timers keep working) at `iso`. */
function freezeAt(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

describe("date helpers (Asia/Manila)", () => {
  it("today/month boundaries use APP_TIMEZONE, not UTC", () => {
    // 2026-11-30 16:30 UTC = 2026-12-01 00:30 in Manila (UTC+8)
    const t = new Date("2026-11-30T16:30:00Z");
    expect(todayDateOnly(t)).toBe("2026-12-01");
    expect(todayDateOnly(new Date("2026-11-30T15:59:59Z"))).toBe("2026-11-30");
    expect(zonedStartOfDay("2026-12-01").toISOString()).toBe("2026-11-30T16:00:00.000Z");
    const m = currentMonthRange(t);
    expect(m.start.toISOString()).toBe("2026-11-30T16:00:00.000Z");
    expect(m.end.toISOString()).toBe("2026-12-31T16:00:00.000Z");
  });

  it("reference number formats as BR- and parses BR-, old LN- and bare numbers", () => {
    expect(formatLoanNumber(123)).toBe("BR-000123");
    expect(formatLoanNumber(1234567)).toBe("BR-1234567");
    for (const s of ["BR-000123", "br-123", " BR000123 ", "LN-000123", "ln-123", " LN000123 ", "123", "000123"]) {
      expect(parseLoanNumber(s), s).toBe(123);
    }
    for (const s of ["abc", "BR-", "LN-", "", "12a", "-1", "XX-123", "BRLN-123", "0"]) expect(parseLoanNumber(s), s).toBeNull();
  });
});

describe("overdue", () => {
  it("is computed against today in Asia/Manila (differs from UTC near midnight)", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary({ defaultLoanDays: 7 });
    const book = await createBook(lib.id, { totalCopies: 5 });
    const a = await staffLoan(agent, lib.id, [{ bookId: book.id, quantity: 1 }], { name: "Due Nov 3" });
    const b = await staffLoan(agent, lib.id, [{ bookId: book.id, quantity: 1 }], { name: "Due Nov 4" });
    const c = await staffLoan(agent, lib.id, [{ bookId: book.id, quantity: 1 }], { name: "Due Oct 31" });
    await prisma.loan.update({ where: { id: a.id }, data: { dueDate: dateOnlyToDate("2026-11-03") } });
    await prisma.loan.update({ where: { id: b.id }, data: { dueDate: dateOnlyToDate("2026-11-04") } });
    await prisma.loan.update({ where: { id: c.id }, data: { dueDate: dateOnlyToDate("2026-10-31") } });

    // 2026-11-03T16:30Z is still Nov 3 in UTC but already Nov 4 (00:30) in Manila.
    freezeAt("2026-11-03T16:30:00Z");
    const la = (await agent.get(`/api/loans/${a.id}`)).body;
    expect(la).toMatchObject({ isOverdue: true, daysOverdue: 1, dueDate: "2026-11-03" });
    const lb = (await agent.get(`/api/loans/${b.id}`)).body;
    expect(lb).toMatchObject({ isOverdue: false, daysOverdue: 0 });
    const lc = (await agent.get(`/api/loans/${c.id}`)).body;
    expect(lc).toMatchObject({ isOverdue: true, daysOverdue: 4 });

    const list = await agent.get("/api/loans?overdue=true");
    expect(list.body.data.map((l: { id: string }) => l.id).sort()).toEqual([a.id, c.id].sort());
    const notOverdue = await agent.get("/api/loans?overdue=false");
    expect(notOverdue.body.data.map((l: { id: string }) => l.id)).toEqual([b.id]);

    // one minute earlier in Manila (Nov 3, 23:59) the Nov-3 loan is not overdue yet
    vi.setSystemTime(new Date("2026-11-03T15:59:00Z"));
    expect((await agent.get(`/api/loans/${a.id}`)).body).toMatchObject({ isOverdue: false, daysOverdue: 0 });

    // book detail flags it too
    vi.setSystemTime(new Date("2026-11-03T16:30:00Z"));
    const detail = (await agent.get(`/api/books/${book.id}`)).body;
    expect(detail.currentLoans.map((l: { dueDate: string; isOverdue: boolean }) => [l.dueDate, l.isOverdue])).toEqual([
      ["2026-10-31", true],
      ["2026-11-03", true],
      ["2026-11-04", false],
    ]);

    // returned loans are never overdue
    await agent.post(`/api/loans/${c.id}/returns`).send({ items: [{ loanItemId: c.items[0].id, good: 1 }] });
    expect((await agent.get(`/api/loans/${c.id}`)).body).toMatchObject({ status: "RETURNED", isOverdue: false, daysOverdue: 0 });
  });

  it("default due date = Manila today + defaultLoanDays; past-date validation uses Manila today", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary({ defaultLoanDays: 7 });
    const book = await createBook(lib.id, { totalCopies: 5 });
    freezeAt("2026-11-03T16:30:00Z"); // Manila: 2026-11-04
    const loan = await staffLoan(agent, lib.id, [{ bookId: book.id, quantity: 1 }]);
    expect(loan.dueDate).toBe("2026-11-11");
    const res = await agent.post("/api/loans").send({ libraryId: lib.id, borrower: { name: "Juan" }, items: [{ bookId: book.id, quantity: 1 }], dueDate: "2026-11-03" });
    expect(res.status).toBe(400); // yesterday in Manila even though it is "today" in UTC
  });
});

describe("dashboard", () => {
  it("returns totals, loan counts, lists and activity (scoped by library)", async () => {
    const { agent, user } = await loginAs("staff");
    const lib = await createLibrary({ name: "Main", slug: "main", publicFormEnabled: true });
    const other = await createLibrary({ name: "Other" });
    const b1 = await createBook(lib.id, { totalCopies: 5 });
    const b2 = await createBook(lib.id, { totalCopies: 2 });
    await createBook(lib.id, { totalCopies: 9, archived: true });
    const ob = await createBook(other.id, { totalCopies: 4 });

    freezeAt("2026-11-10T02:00:00Z"); // Manila 2026-11-10 10:00
    const active = await staffLoan(agent, lib.id, [{ bookId: b1.id, quantity: 3 }], { name: "Active Ana" });
    vi.setSystemTime(new Date("2026-11-10T02:01:00Z"));
    const overdue = await staffLoan(agent, lib.id, [{ bookId: b2.id, quantity: 2 }], { name: "Late Lito" });
    await prisma.loan.update({ where: { id: overdue.id }, data: { dueDate: dateOnlyToDate("2026-11-01") } });
    vi.setSystemTime(new Date("2026-11-10T02:02:00Z"));
    const pending = await publicRequest("main", [{ bookId: b1.id, quantity: 1 }], { name: "Pending Pia" });
    vi.setSystemTime(new Date("2026-11-10T02:03:00Z"));
    const rejected = await publicRequest("main", [{ bookId: b1.id, quantity: 1 }], { name: "Rejected Rey" });
    vi.setSystemTime(new Date("2026-11-10T02:04:00Z"));
    await agent.post(`/api/loans/${rejected.id}/reject`).send({ reason: "dup" });
    vi.setSystemTime(new Date("2026-11-10T02:05:00Z"));
    await agent.post(`/api/loans/${active.id}/returns`).send({ items: [{ loanItemId: active.items[0].id, good: 1 }] });
    vi.setSystemTime(new Date("2026-11-10T02:06:00Z"));
    const done = await staffLoan(agent, other.id, [{ bookId: ob.id, quantity: 1 }], { name: "Done Dina" });
    vi.setSystemTime(new Date("2026-11-10T02:07:00Z"));
    await agent.post(`/api/loans/${done.id}/returns`).send({ items: [{ loanItemId: done.items[0].id, good: 1 }] });
    // a loan returned last month (Manila) is not "this month"
    vi.setSystemTime(new Date("2026-11-10T02:08:00Z"));
    const old = await staffLoan(agent, other.id, [{ bookId: ob.id, quantity: 1 }], { name: "Old Olga" });
    vi.setSystemTime(new Date("2026-11-10T02:09:00Z"));
    await agent.post(`/api/loans/${old.id}/returns`).send({ items: [{ loanItemId: old.items[0].id, good: 1 }] });
    await prisma.loan.update({ where: { id: old.id }, data: { closedAt: new Date("2026-10-31T15:59:00Z") } }); // Oct 31 23:59 Manila

    vi.setSystemTime(new Date("2026-11-10T03:00:00Z"));
    const all = (await agent.get("/api/dashboard")).body;
    expect(all.totals).toEqual({ books: 3, copies: 11, available: 11 - 2 - 2, borrowedOut: 4 });
    expect(all.loans).toEqual({ pending: 1, active: 2, overdue: 1, returnedThisMonth: 1 });
    expect(all.overdueLoans.map((l: { id: string }) => l.id)).toEqual([overdue.id]);
    expect(all.overdueLoans[0]).toMatchObject({ isOverdue: true, daysOverdue: 9, loanNumber: overdue.loanNumber });
    expect(all.pendingLoans.map((l: { id: string }) => l.id)).toEqual([pending.id]);
    expect(all.recentActivity.length).toBeLessThanOrEqual(15);
    const types = all.recentActivity.map((a: { type: string; borrowerName: string }) => `${a.type}:${a.borrowerName}`);
    expect(types.slice(0, 7)).toEqual([
      "RETURNED:Old Olga",
      "BORROWED:Old Olga",
      "RETURNED:Done Dina",
      "BORROWED:Done Dina",
      "RETURNED:Active Ana",
      "REJECTED:Rejected Rey",
      "REQUESTED:Rejected Rey",
    ]);
    const rej = all.recentActivity.find((a: { type: string }) => a.type === "REJECTED");
    expect(rej).toEqual({
      type: "REJECTED",
      loanId: rejected.id,
      loanNumber: formatLoanNumber(rejected.number),
      borrowerName: "Rejected Rey",
      libraryName: "Main",
      at: "2026-11-10T02:04:00.000Z",
      byName: user.name,
    });
    expect(all.recentActivity.find((a: { type: string }) => a.type === "REQUESTED").byName).toBeNull();

    const scoped = (await agent.get(`/api/dashboard?libraryId=${lib.id}`)).body;
    expect(scoped.totals).toEqual({ books: 2, copies: 7, available: 3, borrowedOut: 4 });
    expect(scoped.loans).toEqual({ pending: 1, active: 2, overdue: 1, returnedThisMonth: 0 });
    expect(scoped.recentActivity.every((a: { libraryName: string }) => a.libraryName === "Main")).toBe(true);
  });

  it("empty database gives zeroes", async () => {
    const { agent } = await loginAs("staff");
    const res = await agent.get("/api/dashboard");
    expect(res.body).toEqual({
      totals: { books: 0, copies: 0, available: 0, borrowedOut: 0 },
      loans: { pending: 0, active: 0, overdue: 0, returnedThisMonth: 0 },
      overdueLoans: [],
      pendingLoans: [],
      recentActivity: [],
    });
  });
});
