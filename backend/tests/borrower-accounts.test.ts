/**
 * One account system (docs/SPEC.md "Accounts"): accepting a public request creates (or links) an ordinary account
 * with the default role for the borrower; "My Books" (GET /me/loans) shows that borrower's records; a password
 * given by the library must be changed first. Also the accept/reject emails.
 */
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { env } from "../src/config/env.js";
import { prisma } from "../src/lib/prisma.js";
import { DEFAULT_STAFF_PERMISSIONS, normalizePermissions } from "../src/lib/permissions.js";
import { setMailTransportForTests, testOutbox } from "../src/lib/mailer.js";
import { app, createBook, createLibrary, createRole, createUser, loginAs, PASSWORD, publicRequest, signIn } from "./helpers.js";

const DEFAULT_PASSWORD = "password123"; // BORROWER_DEFAULT_PASSWORD in vitest.config.ts
const LOGIN_URL = "http://localhost:5174/login"; // APP_PUBLIC_URL in vitest.config.ts

/** The default role (Role.isDefault) accepted borrowers get, like the "Staff" role of a real database. */
async function createDefaultRole() {
  return prisma.role.create({ data: { name: "Staff", permissions: [...DEFAULT_STAFF_PERMISSIONS], isDefault: true } });
}

/**
 * A public-form library with two books, a pending request from Maria, a default role (unless `defaultRole` is
 * false) and a staff agent that can approve it.
 */
async function pendingRequest(
  borrower: { name: string; email: string; idNumber?: string } = { name: "Maria Clara", email: "maria@example.com" },
  options: { defaultRole?: boolean } = {},
) {
  const defaultRole = options.defaultRole === false ? null : await createDefaultRole();
  const lib = await createLibrary({ name: "Parish Library", slug: "parish", publicFormEnabled: true, defaultLoanDays: 14 });
  await prisma.library.update({ where: { id: lib.id }, data: { location: "2nd floor, Parish Hall" } });
  const noli = await prisma.book.create({
    data: { libraryId: lib.id, title: "Noli Me Tangere", author: "José Rizal", totalCopies: 3, availableCopies: 3 },
  });
  const fili = await createBook(lib.id, { title: "El Filibusterismo", totalCopies: 3 });
  const loan = await publicRequest("parish", [{ bookId: noli.id, quantity: 2 }, { bookId: fili.id, quantity: 1 }], borrower);
  const { agent } = await loginAs("staff");
  return { lib, noli, fili, loan, agent, defaultRole };
}

const lastMail = () => testOutbox[testOutbox.length - 1]!;
const cookieOf = (res: request.Response) => (res.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("lms_token="))!;
/** The account linked to a borrower (null when none). */
const accountOf = (borrowerId: string) => prisma.user.findUnique({ where: { borrowerId } });

async function signInOk(email: string, password = DEFAULT_PASSWORD) {
  const { agent, res } = await signIn(email, password);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { agent, res };
}

/** Signs in with the default password and changes it (the API refuses everything else until then). */
async function signInChanged(email: string, newPassword = "MyOwnPass1") {
  const { agent } = await signInOk(email);
  const res = await agent.patch("/api/auth/password").send({ currentPassword: DEFAULT_PASSWORD, newPassword });
  expect(res.status, JSON.stringify(res.body)).toBe(204);
  return { agent };
}

describe("accept / reject emails", () => {
  it("accepting creates an account with the default role, linked to the borrower, and emails the default password", async () => {
    await prisma.companyProfile.update({
      where: { id: 1 },
      data: { name: "St. Luke Library", address: "123 Rizal St.", contactEmail: "desk@stluke.ph", contactPhone: "0917 555 0000" },
    });
    const { loan, agent, defaultRole } = await pendingRequest();
    const res = await agent.post(`/api/loans/${loan.id}/approve`).send({ dueDate: "2099-01-06" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "BORROWED",
      borrower: { name: "Maria Clara", email: "maria@example.com" },
      notification: { sentAt: expect.any(String), error: null },
    });

    // An ordinary account: the default role, the borrower's name and email, linked, must change the password.
    const account = await accountOf(loan.borrowerId);
    expect(account).toMatchObject({
      email: "maria@example.com",
      name: "Maria Clara",
      roleId: defaultRole!.id,
      active: true,
      mustChangePassword: true,
      borrowerId: loan.borrowerId,
    });
    expect(await prisma.user.count({ where: { email: "maria@example.com" } })).toBe(1);
    // The deprecated borrower password columns are not used any more.
    expect((await prisma.borrower.findUniqueOrThrow({ where: { id: loan.borrowerId } })).passwordHash).toBeNull();

    expect(testOutbox).toHaveLength(1);
    const mail = lastMail();
    expect(mail.to).toBe("maria@example.com");
    expect(mail.from).toBe('"St. Luke Library" <no-reply@localhost>');
    expect(mail.subject).toBe("St. Luke Library: your borrow request BR-000001 was accepted");
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain("Maria Clara");
      expect(body).toContain("BR-000001");
      expect(body).toContain("Noli Me Tangere by José Rizal (2 copies)");
      expect(body).toContain("El Filibusterismo");
      expect(body).toContain("Tuesday, 6 January 2099");
      expect(body).toContain("Parish Library (2nd floor, Parish Hall)");
      expect(body).toContain(LOGIN_URL);
      expect(body).toContain("maria@example.com");
      expect(body).toContain(`the default password: ${DEFAULT_PASSWORD}`);
      expect(body).toContain("Please change this password after you sign in.");
      expect(body).toContain("123 Rizal St.");
      expect(body).toContain("desk@stluke.ph");
      expect(body).toContain("0917 555 0000");
    }
    expect(mail.text.split(DEFAULT_PASSWORD)).toHaveLength(2); // exactly once
    expect(mail.html).toContain(`<a href="${LOGIN_URL}">${LOGIN_URL}</a>`);

    // The default password works right away; the account is a normal { user } (and must change it).
    const { res: login } = await signInOk("maria@example.com");
    expect(login.body).toEqual({
      user: {
        id: account!.id,
        email: "maria@example.com",
        name: "Maria Clara",
        role: { id: defaultRole!.id, name: "Staff" },
        active: true,
        mustChangePassword: true,
        borrower: { id: loan.borrowerId, name: "Maria Clara" },
        createdAt: expect.any(String),
        permissions: normalizePermissions(DEFAULT_STAFF_PERMISSIONS),
      },
    });
    expect(login.body.user.permissions).toContain("my_books.view");
  });

  it("a later acceptance for the same borrower reuses the account and does not repeat the password", async () => {
    const { loan, noli, agent } = await pendingRequest();
    await agent.post(`/api/loans/${loan.id}/approve`).send({});
    const account = await accountOf(loan.borrowerId);
    const second = await publicRequest("parish", [{ bookId: noli.id, quantity: 1 }], { name: "Maria", email: "Maria@Example.com" });
    expect(second.borrowerId).toBe(loan.borrowerId);
    const res = await agent.post(`/api/loans/${second.id}/approve`).send({});
    expect(res.status).toBe(200);
    expect(testOutbox).toHaveLength(2);
    const mail = lastMail();
    expect(mail.subject).toBe("Library System: your borrow request BR-000002 was accepted");
    expect(mail.text).not.toContain(DEFAULT_PASSWORD);
    expect(mail.html).not.toContain(DEFAULT_PASSWORD);
    expect(mail.text).toContain(`Sign in at ${LOGIN_URL} with your email maria@example.com and your password to see your borrowed books.`);
    // Still one account, unchanged.
    expect(await prisma.user.count({ where: { borrowerId: loan.borrowerId } })).toBe(1);
    expect((await accountOf(loan.borrowerId))!.id).toBe(account!.id);
  });

  it("two approvals for one borrower at the same time create the account (and announce the password) once", async () => {
    const { loan, noli, agent } = await pendingRequest();
    const second = await publicRequest("parish", [{ bookId: noli.id, quantity: 1 }], { name: "Maria", email: "maria@example.com" });
    const results = await Promise.all([
      agent.post(`/api/loans/${loan.id}/approve`).send({}),
      agent.post(`/api/loans/${second.id}/approve`).send({}),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(testOutbox).toHaveLength(2);
    expect(testOutbox.filter((m) => m.text.includes(DEFAULT_PASSWORD))).toHaveLength(1);
    expect(await prisma.user.count({ where: { email: "maria@example.com" } })).toBe(1);
  });

  it("an existing account with the borrower's email is linked (its password and role are kept)", async () => {
    const adminRole = await createRole("all", "Administrator");
    const existing = await createUser({ email: "maria@example.com", roleId: adminRole.id, name: "Maria (staff)" });
    const { loan, agent } = await pendingRequest();
    expect((await agent.post(`/api/loans/${loan.id}/approve`).send({})).status).toBe(200);

    const linked = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
    expect(linked).toMatchObject({ borrowerId: loan.borrowerId, roleId: adminRole.id, mustChangePassword: false, name: "Maria (staff)" });
    expect(linked.passwordHash).toBe(existing.passwordHash);
    expect(await prisma.user.count({ where: { email: "maria@example.com" } })).toBe(1);
    // The email does not hand out a password; the own password still works, the default one does not.
    expect(lastMail().text).not.toContain(DEFAULT_PASSWORD);
    expect(lastMail().text).toContain("with your email maria@example.com and your password");
    expect((await signIn("maria@example.com", DEFAULT_PASSWORD)).res.status).toBe(401);
    const { res } = await signInOk("maria@example.com", PASSWORD);
    expect(res.body.user.borrower).toEqual({ id: loan.borrowerId, name: "Maria Clara" });
  });

  it("an account with the borrower's email that belongs to another borrower stays theirs", async () => {
    const { loan, agent } = await pendingRequest();
    const other = await prisma.borrower.create({ data: { name: "Other Maria" } });
    const existing = await createUser({ email: "maria@example.com" });
    await prisma.user.update({ where: { id: existing.id }, data: { borrowerId: other.id } });
    expect((await agent.post(`/api/loans/${loan.id}/approve`).send({})).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: existing.id } })).borrowerId).toBe(other.id);
    expect(await accountOf(loan.borrowerId)).toBeNull();
    expect(lastMail().text).not.toContain(DEFAULT_PASSWORD);
  });

  it("without a default role no account is created and the email has no sign-in part", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { loan, agent } = await pendingRequest(undefined, { defaultRole: false });
      const res = await agent.post(`/api/loans/${loan.id}/approve`).send({});
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("BORROWED");
      expect(await accountOf(loan.borrowerId)).toBeNull();
      expect(await prisma.user.count({ where: { email: "maria@example.com" } })).toBe(0);
      expect(warn).toHaveBeenCalled();
      const mail = lastMail();
      expect(mail.subject).toContain("was accepted");
      for (const body of [mail.text, mail.html]) {
        expect(body).not.toContain(DEFAULT_PASSWORD);
        expect(body).not.toContain("/login");
        expect(body).not.toContain("Sign in");
      }
      // A resend has no sign-in part either.
      expect((await agent.post(`/api/loans/${loan.id}/notify`).send({})).status).toBe(200);
      expect(lastMail().text).not.toContain("/login");
    } finally {
      warn.mockRestore();
    }
  });

  it("rejecting emails the reason and the books requested, and creates no account", async () => {
    const { loan, agent } = await pendingRequest();
    const res = await agent.post(`/api/loans/${loan.id}/reject`).send({ reason: "These books are reserved for the retreat." });
    expect(res.status).toBe(200);
    expect(res.body.notification).toEqual({ sentAt: expect.any(String), error: null });
    expect(testOutbox).toHaveLength(1);
    const mail = lastMail();
    expect(mail.subject).toBe("Library System: your borrow request BR-000001 was not accepted");
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain("Reason: These books are reserved for the retreat.");
      expect(body).toContain("Noli Me Tangere");
      expect(body).toContain("El Filibusterismo");
      expect(body).not.toContain(DEFAULT_PASSWORD);
      expect(body).not.toContain("/login");
    }
    expect(await accountOf(loan.borrowerId)).toBeNull();
    expect((await signIn("maria@example.com", DEFAULT_PASSWORD)).res.status).toBe(401);
  });

  it("cancelling sends nothing", async () => {
    const { loan, agent } = await pendingRequest();
    const res = await agent.post(`/api/loans/${loan.id}/cancel`).send({});
    expect(res.status).toBe(200);
    expect(res.body.notification).toBeNull();
    expect(testOutbox).toHaveLength(0);
  });

  it("escapes every value in the HTML email (text stays as typed)", async () => {
    await prisma.companyProfile.update({ where: { id: 1 }, data: { name: `Tom & Jerry's "Library"`, address: "<b>Main</b> St." } });
    const { loan, noli, agent } = await pendingRequest({ name: "<script>alert(1)</script>", email: "x@example.com" });
    await prisma.book.update({ where: { id: noli.id }, data: { title: "Cats & <Dogs>", author: `"Quoted" <i>` } });
    await agent.post(`/api/loans/${loan.id}/reject`).send({ reason: `<img src=x onerror="alert(1)">` });
    const mail = lastMail();
    expect(mail.html).not.toMatch(/<script>|<img|<b>Main|<Dogs>|<i>/);
    expect(mail.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(mail.html).toContain("Cats &amp; &lt;Dogs&gt; by &quot;Quoted&quot; &lt;i&gt;");
    expect(mail.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(mail.html).toContain("Tom &amp; Jerry&#39;s &quot;Library&quot;");
    expect(mail.html).toContain("&lt;b&gt;Main&lt;/b&gt; St.");
    expect(mail.text).toContain("Hello <script>alert(1)</script>,");
    expect(mail.subject).toBe(`Tom & Jerry's "Library": your borrow request BR-000001 was not accepted`);
  });

  it("a borrower without an email gets no email and no account", async () => {
    const lib = await createLibrary({ slug: "parish", publicFormEnabled: true });
    const book = await createBook(lib.id);
    const borrower = await prisma.borrower.create({ data: { name: "Old Request" } });
    const loan = await prisma.loan.create({
      data: { libraryId: lib.id, borrowerId: borrower.id, source: "PUBLIC_FORM", status: "PENDING", items: { create: [{ bookId: book.id, quantity: 1 }] } },
    });
    const { agent } = await loginAs("staff");
    const res = await agent.post(`/api/loans/${loan.id}/approve`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "BORROWED", borrower: { email: null }, notification: null });
    expect(testOutbox).toHaveLength(0);
    expect(await accountOf(borrower.id)).toBeNull();
    const resend = await agent.post(`/api/loans/${loan.id}/notify`).send({});
    expect(resend.status).toBe(400);
    expect(resend.body.error.code).toBe("NO_EMAIL");
  });

  it("an SMTP failure is recorded on the record (the acceptance still happens); a resend can fix it", async () => {
    const { loan, agent } = await pendingRequest();
    setMailTransportForTests(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:587");
    });
    const res = await agent.post(`/api/loans/${loan.id}/approve`).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("BORROWED");
    expect(res.body.notification).toEqual({ sentAt: null, error: "connect ECONNREFUSED 127.0.0.1:587" });
    expect((await agent.get(`/api/loans/${loan.id}`)).body.notification.error).toContain("ECONNREFUSED");
    // The account exists anyway.
    expect((await accountOf(loan.borrowerId))!.mustChangePassword).toBe(true);

    // Long errors are cut to 300 characters.
    setMailTransportForTests(async () => {
      throw new Error("x".repeat(1000));
    });
    const long = await agent.post(`/api/loans/${loan.id}/notify`).send({});
    expect(long.body.notification.error).toHaveLength(300);

    // Back to the working transport: the resend repeats the default password, since it is still unchanged.
    setMailTransportForTests(null);
    const resend = await agent.post(`/api/loans/${loan.id}/notify`).send({});
    expect(resend.status).toBe(200);
    expect(resend.body.notification).toEqual({ sentAt: expect.any(String), error: null });
    expect(testOutbox).toHaveLength(1);
    expect(lastMail().text).toContain(`the default password: ${DEFAULT_PASSWORD}`);
  });

  it("resend: only for accepted or rejected online requests; never repeats a password the borrower changed", async () => {
    const { loan, noli, agent, lib } = await pendingRequest();
    const pending = await agent.post(`/api/loans/${loan.id}/notify`).send({});
    expect(pending.status).toBe(409);
    expect(pending.body.error).toMatchObject({ code: "INVALID_STATUS", details: { status: "PENDING" } });
    expect((await agent.post("/api/loans/nope/notify").send({})).status).toBe(404);

    // A staff "Borrow Books" record never had a decision email.
    const staffLoan = await agent.post("/api/loans").send({ libraryId: lib.id, borrower: { name: "Walk In", email: "walkin@example.com" }, items: [{ bookId: noli.id, quantity: 1 }] });
    expect(staffLoan.status).toBe(201);
    expect((await agent.post(`/api/loans/${staffLoan.body.id}/notify`).send({})).status).toBe(409);

    const cancelled = await publicRequest("parish", [{ bookId: noli.id, quantity: 1 }], { name: "Ana", email: "ana@example.com" });
    await agent.post(`/api/loans/${cancelled.id}/cancel`).send({});
    expect((await agent.post(`/api/loans/${cancelled.id}/notify`).send({})).status).toBe(409);

    const rejected = await publicRequest("parish", [{ bookId: noli.id, quantity: 1 }], { name: "Ben", email: "ben@example.com" });
    await agent.post(`/api/loans/${rejected.id}/reject`).send({ reason: "Duplicate request" });
    const resendRejected = await agent.post(`/api/loans/${rejected.id}/notify`).send({});
    expect(resendRejected.status).toBe(200);
    expect(lastMail()).toMatchObject({ to: "ben@example.com", subject: expect.stringContaining("was not accepted") });
    expect(lastMail().text).toContain("Reason: Duplicate request");
    expect(await accountOf(rejected.borrowerId)).toBeNull();

    // Accepted, then the borrower changes the default password: a resend no longer contains it.
    await agent.post(`/api/loans/${loan.id}/approve`).send({});
    const { agent: maria } = await signInOk("maria@example.com");
    expect((await maria.patch("/api/auth/password").send({ currentPassword: DEFAULT_PASSWORD, newPassword: "MyOwnPass1" })).status).toBe(204);
    const sent = testOutbox.length;
    const resend = await agent.post(`/api/loans/${loan.id}/notify`).send({});
    expect(resend.status).toBe(200);
    expect(testOutbox).toHaveLength(sent + 1);
    expect(lastMail().text).not.toContain(DEFAULT_PASSWORD);
    expect(lastMail().text).toContain("with your email maria@example.com and your password");

    // Still allowed after everything was returned.
    const items = resend.body.items.map((it: { id: string; quantity: number }) => ({ loanItemId: it.id, good: it.quantity, damaged: 0, lost: 0 }));
    expect((await agent.post(`/api/loans/${loan.id}/returns`).send({ items })).body.status).toBe("RETURNED");
    expect((await agent.post(`/api/loans/${loan.id}/notify`).send({})).status).toBe(200);
  });

  it("resend after the borrower's email was corrected: sent to the new email, sign in with the account's email", async () => {
    const { loan, agent } = await pendingRequest({ name: "Maria Clara", email: "maria@exmaple.com" });
    await agent.post(`/api/loans/${loan.id}/approve`).send({});
    expect((await agent.patch(`/api/borrowers/${loan.borrowerId}`).send({ email: "maria@example.com" })).status).toBe(200);
    expect((await agent.post(`/api/loans/${loan.id}/notify`).send({})).status).toBe(200);
    expect(lastMail().to).toBe("maria@example.com");
    // Editing the borrower never changes the account: the email names the address that actually signs in.
    expect(lastMail().text).toContain(`with your email maria@exmaple.com and the default password: ${DEFAULT_PASSWORD}`);
    expect((await signIn("maria@exmaple.com", DEFAULT_PASSWORD)).res.status).toBe(200);
  });

  it("resend after an admin set another password: the default password is not repeated", async () => {
    const { loan, agent } = await pendingRequest();
    await agent.post(`/api/loans/${loan.id}/approve`).send({});
    const account = (await accountOf(loan.borrowerId))!;
    const { agent: admin } = await loginAs("all");
    expect((await admin.patch(`/api/users/${account.id}`).send({ password: "Temp-1234x" })).status).toBe(200);
    // Still forced to choose their own password, but the default one no longer works.
    expect((await accountOf(loan.borrowerId))!.mustChangePassword).toBe(true);
    expect((await agent.post(`/api/loans/${loan.id}/notify`).send({})).status).toBe(200);
    expect(lastMail().text).not.toContain(DEFAULT_PASSWORD);
    expect(lastMail().text).toContain("with your email maria@example.com and your password");
  });
});

describe("one account: sign-in, My Books, forced password change", () => {
  async function acceptedBorrower(borrower = { name: "Maria Clara", email: "maria@example.com" }) {
    const setup = await pendingRequest(borrower);
    await setup.agent.post(`/api/loans/${setup.loan.id}/approve`).send({ dueDate: "2099-03-10" });
    return setup;
  }

  it("an accepted borrower signs in like any account: /auth/me returns { user }, logout ends the session", async () => {
    const { loan } = await acceptedBorrower();
    const { agent, res } = await signInOk("MARIA@example.com ");
    expect(res.body.borrower).toBeUndefined();
    const cookie = cookieOf(res);
    expect(cookie).toMatch(/HttpOnly/i);

    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(Object.keys(me.body)).toEqual(["user"]);
    expect(me.body.user).toMatchObject({
      email: "maria@example.com",
      mustChangePassword: true,
      borrower: { id: loan.borrowerId, name: "Maria Clara" },
    });
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash|tokenVersion|\$2[aby]\$/);

    expect((await agent.post("/api/auth/logout").send({})).status).toBe(204);
    expect((await agent.get("/api/auth/me")).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(401);
  });

  it("tokens of the former borrower portal (kind: borrower) are never accepted", async () => {
    const { loan } = await acceptedBorrower();
    const account = await accountOf(loan.borrowerId);
    for (const sub of [loan.borrowerId, account!.id]) {
      const token = jwt.sign({ sub, ver: 0, kind: "borrower" }, env.jwtSecret, { expiresIn: 3600, algorithm: "HS256" });
      for (const path of ["/api/auth/me", "/api/me/loans", "/api/books"]) {
        const res = await request(app).get(path).set("Cookie", `lms_token=${token}`);
        expect(res.status, `${sub} ${path}`).toBe(401);
      }
    }
    expect((await request(app).get("/api/portal/loans")).status).toBe(404);
  });

  it("until the default password is changed, the API refuses everything but /auth and the permission catalog", async () => {
    const { loan } = await acceptedBorrower();
    const { agent: maria } = await signInOk("maria@example.com");
    for (const path of ["/api/books", "/api/borrowers", `/api/loans/${loan.id}`, "/api/libraries", "/api/dashboard", "/api/me/loans", "/api/users"]) {
      const res = await maria.get(path);
      expect(res.status, path).toBe(403);
      expect(res.body.error.code, path).toBe("PASSWORD_CHANGE_REQUIRED");
    }
    expect((await maria.post(`/api/loans/${loan.id}/cancel`).send({})).body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect((await maria.get("/api/auth/me")).status).toBe(200);
    expect((await maria.get("/api/permissions")).status).toBe(200);
    // An admin-set password does not lift it either (the account still has to choose its own).
    const account = (await accountOf(loan.borrowerId))!;
    const { agent: admin } = await loginAs("all");
    await admin.patch(`/api/users/${account.id}`).send({ password: "Temp-1234x" });
    const { agent: again } = await signInOk("maria@example.com", "Temp-1234x");
    expect((await again.get("/api/books")).body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect((await again.patch("/api/auth/password").send({ currentPassword: "Temp-1234x", newPassword: "MyOwnPass1" })).status).toBe(204);
    expect((await again.get("/api/books")).status).toBe(200);
  });

  it("what an accepted borrower can open is decided by the default role's permissions", async () => {
    await acceptedBorrower();
    const { agent: maria } = await signInChanged("maria@example.com");
    // The default "Staff" permissions in this test: books are visible, accounts are not.
    expect((await maria.get("/api/books")).status).toBe(200);
    expect((await maria.get("/api/users")).status).toBe(403);
    expect((await maria.get("/api/me/loans")).status).toBe(200);
  });

  it("POST /me/requests: a signed-in borrower requests more books without the details form", async () => {
    const { lib, fili, agent, loan } = await acceptedBorrower();
    const { agent: maria } = await signInChanged("maria@example.com");
    const res = await maria.post("/api/me/requests").send({ slug: "PARISH", items: [{ bookId: fili.id, quantity: 1 }], notes: "Thanks!" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({ loanNumber: "BR-000002", status: "PENDING", email: "maria@example.com" });
    const created = await prisma.loan.findUniqueOrThrow({ where: { number: 2 }, include: { items: true } });
    expect(created).toMatchObject({
      libraryId: lib.id,
      borrowerId: loan.borrowerId,
      source: "PUBLIC_FORM",
      status: "PENDING",
      submittedName: "Maria Clara",
      notes: "Thanks!",
    });
    expect(created.items.map((i) => [i.bookId, i.quantity])).toEqual([[fili.id, 1]]);
    // Staff accept it like any public request, and the email goes to the borrower.
    const accepted = await agent.post(`/api/loans/${created.id}/approve`).send({});
    expect(accepted.status).toBe(200);
    expect(lastMail().to).toBe("maria@example.com");
    expect(lastMail().text).not.toContain(DEFAULT_PASSWORD); // the account already exists
  });

  it("POST /me/requests: same item rules as the public form; disabled form 404; unlinked account 409; permission", async () => {
    const { lib, noli, fili } = await acceptedBorrower();
    const { agent: maria } = await signInChanged("maria@example.com");
    const send = (body: object) => maria.post("/api/me/requests").send(body);
    expect((await send({ slug: "parish", items: [] })).status).toBe(400);
    expect((await send({ slug: "parish", items: [{ bookId: fili.id, quantity: 6 }] })).status).toBe(400);
    const dup = await send({ slug: "parish", items: [{ bookId: fili.id, quantity: 1 }, { bookId: fili.id, quantity: 1 }] });
    expect(dup.status).toBe(400);
    const other = await createLibrary({ name: "Other", slug: "other", publicFormEnabled: true });
    const foreign = await createBook(other.id, { title: "Elsewhere" });
    const invalid = await send({ slug: "parish", items: [{ bookId: foreign.id, quantity: 1 }] });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("INVALID_BOOKS");
    expect((await send({ slug: "nope", items: [{ bookId: noli.id, quantity: 1 }] })).status).toBe(404);
    await prisma.library.update({ where: { id: lib.id }, data: { publicFormEnabled: false } });
    expect((await send({ slug: "parish", items: [{ bookId: noli.id, quantity: 1 }] })).status).toBe(404);
    await prisma.library.update({ where: { id: lib.id }, data: { publicFormEnabled: true } });

    // A staff account with My Books but no linked borrower.
    await createUser({ email: "clerk@example.com", permissions: ["my_books.view"] });
    const { agent: clerk } = await signIn("clerk@example.com", PASSWORD);
    const notLinked = await clerk.post("/api/me/requests").send({ slug: "parish", items: [{ bookId: noli.id, quantity: 1 }] });
    expect(notLinked.status).toBe(409);
    expect(notLinked.body.error.code).toBe("NOT_LINKED");
    // Without my_books.view → 403; signed out → 401.
    await createUser({ email: "nobooks@example.com", permissions: [] });
    const { agent: nobooks } = await signIn("nobooks@example.com", PASSWORD);
    expect((await nobooks.post("/api/me/requests").send({ slug: "parish", items: [{ bookId: noli.id, quantity: 1 }] })).status).toBe(403);
    expect((await request(app).post("/api/me/requests").send({ slug: "parish", items: [{ bookId: noli.id, quantity: 1 }] })).status).toBe(401);
  });

  it("GET /me/loans shows only the linked borrower's records, newest first, without staff data", async () => {
    const { noli, fili, agent, loan } = await acceptedBorrower();
    // Maria: a second, rejected request and a third, cancelled one (cancel notes stay internal).
    const rejected = await publicRequest("parish", [{ bookId: fili.id, quantity: 1 }], { name: "Maria", email: "maria@example.com" });
    await agent.post(`/api/loans/${rejected.id}/reject`).send({ reason: "Only one request at a time." });
    const cancelled = await publicRequest("parish", [{ bookId: fili.id, quantity: 1 }], { name: "Maria", email: "maria@example.com" });
    await agent.post(`/api/loans/${cancelled.id}/cancel`).send({ reason: "internal: duplicate" });
    // Ben: his own request, accepted too.
    const bens = await publicRequest("parish", [{ bookId: noli.id, quantity: 1 }], { name: "Ben Secret", email: "ben@example.com" });
    await agent.post(`/api/loans/${bens.id}/approve`).send({});

    const { agent: maria } = await signInChanged("maria@example.com");
    const res = await maria.get("/api/me/loans");
    expect(res.status).toBe(200);
    expect(res.body.borrower).toEqual({ id: loan.borrowerId, name: "Maria Clara" });
    expect(res.body.data.map((l: { loanNumber: string }) => l.loanNumber)).toEqual(["BR-000003", "BR-000002", "BR-000001"]);
    const [c, r, accepted] = res.body.data;
    expect(accepted).toEqual({
      id: expect.any(String),
      loanNumber: "BR-000001",
      status: "BORROWED",
      library: { name: "Parish Library", slug: "parish" },
      requestedAt: expect.any(String),
      borrowedAt: expect.any(String),
      dueDate: "2099-03-10",
      closedAt: null,
      isOverdue: false,
      daysOverdue: 0,
      staffNotes: null,
      items: [
        { bookId: noli.id, title: "Noli Me Tangere", author: "José Rizal", quantity: 2, outstanding: 2 },
        { bookId: fili.id, title: "El Filibusterismo", author: null, quantity: 1, outstanding: 1 },
      ],
    });
    expect(r).toMatchObject({ status: "REJECTED", staffNotes: "Only one request at a time.", items: [{ outstanding: 0 }] });
    expect(c).toMatchObject({ status: "CANCELLED", staffNotes: null });
    expect(JSON.stringify(res.body.data)).not.toMatch(/Ben|ben@|createdBy|approvedBy|closedBy|internal|borrower/);

    const { agent: ben } = await signInChanged("ben@example.com");
    const bensList = await ben.get("/api/me/loans");
    expect(bensList.body.borrower.name).toBe("Ben Secret");
    expect(bensList.body.data.map((l: { loanNumber: string }) => l.loanNumber)).toEqual(["BR-000004"]);
  });

  it("GET /me/loans: login and my_books.view required; an unlinked account gets { borrower: null, data: [] }", async () => {
    expect((await request(app).get("/api/me/loans")).status).toBe(401);
    const { agent: without } = await loginAs(normalizePermissions(["books.view"]));
    const forbidden = await without.get("/api/me/loans");
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("FORBIDDEN");
    // A staff account with the permission but no linked borrower sees nothing (never someone else's records).
    await acceptedBorrower();
    const { agent: staff } = await loginAs(normalizePermissions(["my_books.view"]));
    const empty = await staff.get("/api/me/loans");
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ borrower: null, data: [] });
  });

  it("password change clears mustChangePassword; while forced, the default password is refused", async () => {
    await acceptedBorrower();
    const { agent: maria, res: login } = await signInOk("maria@example.com");
    const oldCookie = cookieOf(login);
    const change = (body: object) => maria.patch("/api/auth/password").send(body);

    const wrong = await change({ currentPassword: "nope-nope", newPassword: "MyOwnPass1" });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe("WRONG_PASSWORD");
    const same = await change({ currentPassword: DEFAULT_PASSWORD, newPassword: DEFAULT_PASSWORD });
    expect(same.status).toBe(400);
    expect(same.body.error).toMatchObject({ code: "VALIDATION_ERROR", details: { issues: [{ path: ["newPassword"] }] } });
    expect((await change({ currentPassword: DEFAULT_PASSWORD, newPassword: "short" })).status).toBe(400);

    const ok = await change({ currentPassword: DEFAULT_PASSWORD, newPassword: "MyOwnPass1" });
    expect(ok.status).toBe(204);
    // This session stays signed in (fresh cookie); the old token and the default password stop working.
    expect((await maria.get("/api/auth/me")).body.user.mustChangePassword).toBe(false);
    expect((await request(app).get("/api/me/loans").set("Cookie", oldCookie)).status).toBe(401);
    expect((await signIn("maria@example.com", DEFAULT_PASSWORD)).res.status).toBe(401);
    expect((await signIn("maria@example.com", "MyOwnPass1")).res.body.user.mustChangePassword).toBe(false);
  });

  it("an account that is not forced may pick any valid password, the default one included", async () => {
    const { agent } = await loginAs("staff");
    const res = await agent.patch("/api/auth/password").send({ currentPassword: PASSWORD, newPassword: DEFAULT_PASSWORD });
    expect(res.status).toBe(204);
  });

  it("Users → Accounts lists the account with its borrower and the must-change flag", async () => {
    const { loan } = await acceptedBorrower();
    const { agent: admin } = await loginAs("all");
    const list = await admin.get("/api/users");
    expect(list.status).toBe(200);
    const maria = list.body.data.find((u: { email: string }) => u.email === "maria@example.com");
    expect(maria).toMatchObject({
      name: "Maria Clara",
      role: { name: "Staff" },
      mustChangePassword: true,
      borrower: { id: loan.borrowerId, name: "Maria Clara" },
    });
    const self = list.body.data.find((u: { email: string; name: string }) => u.email !== "maria@example.com" && u.name.startsWith("Admin"));
    expect(self).toMatchObject({ mustChangePassword: false, borrower: null });
  });
});

describe("borrowers: email and linked account (staff)", () => {
  it("create / update with email: normalized, unique (EMAIL_TAKEN), searchable; the hash is never returned", async () => {
    const { agent } = await loginAs("staff");
    const a = await agent.post("/api/borrowers").send({ name: "Ana Santos", email: " Ana@Example.com " });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ email: "ana@example.com", hasAccount: false, mustChangePassword: false, account: null });
    const dup = await agent.post("/api/borrowers").send({ name: "Other Ana", email: "ANA@example.com" });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toEqual({ code: "EMAIL_TAKEN", message: "Another borrower already has this email." });
    expect((await agent.post("/api/borrowers").send({ name: "Bad Email", email: "nope" })).status).toBe(400);
    // Local addresses are fine for staff entry.
    expect((await agent.post("/api/borrowers").send({ name: "Local", email: "local@localhost" })).status).toBe(201);

    const b = await agent.post("/api/borrowers").send({ name: "Ben Cruz", idNumber: "B-1" });
    const dupPatch = await agent.patch(`/api/borrowers/${b.body.id}`).send({ email: "ana@example.com" });
    expect(dupPatch.status).toBe(409);
    expect(dupPatch.body.error.code).toBe("EMAIL_TAKEN");
    const dupId = await agent.post("/api/borrowers").send({ name: "Other Ben", idNumber: "B-1", email: "other@example.com" });
    expect(dupId.body.error.code).toBe("ID_NUMBER_TAKEN");
    const patched = await agent.patch(`/api/borrowers/${b.body.id}`).send({ email: "Ben@Example.com" });
    expect(patched.body.email).toBe("ben@example.com");
    // Re-sending its own email is not a conflict.
    expect((await agent.patch(`/api/borrowers/${b.body.id}`).send({ email: "ben@example.com" })).status).toBe(200);

    expect((await agent.get("/api/borrowers?q=ben@ex")).body.data.map((x: { name: string }) => x.name)).toEqual(["Ben Cruz"]);
    expect(JSON.stringify((await agent.get("/api/borrowers")).body)).not.toMatch(/passwordHash|tokenVersion/);
  });

  it("Borrow Books with a new borrower accepts an email (EMAIL_TAKEN when another borrower has it)", async () => {
    const { agent } = await loginAs("staff");
    const lib = await createLibrary();
    const book = await createBook(lib.id, { totalCopies: 5 });
    const items = [{ bookId: book.id, quantity: 1 }];
    const ok = await agent.post("/api/loans").send({ libraryId: lib.id, borrower: { name: "Carla Reyes", email: "Carla@Example.com" }, items });
    expect(ok.status).toBe(201);
    expect(ok.body.borrower).toMatchObject({ name: "Carla Reyes", email: "carla@example.com" });
    expect(ok.body.notification).toBeNull();

    for (const borrower of [
      { name: "Someone", email: "carla@example.com" },
      { name: "Someone", email: "carla@example.com", idNumber: "NEW-1" },
    ]) {
      const res = await agent.post("/api/loans").send({ libraryId: lib.id, borrower, items });
      expect(res.status, JSON.stringify(borrower)).toBe(409);
      expect(res.body.error.code).toBe("EMAIL_TAKEN");
    }
    expect(await prisma.loan.count()).toBe(1);
    expect((await prisma.book.findUniqueOrThrow({ where: { id: book.id } })).availableCopies).toBe(4);
  });

  it("shows the linked account; hasAccount= filters on the link; editing the borrower never touches the account", async () => {
    const { loan, agent: approver } = await pendingRequest();
    await approver.post(`/api/loans/${loan.id}/approve`).send({});
    const account = (await accountOf(loan.borrowerId))!;
    const { agent } = await loginAs("staff");
    await agent.post("/api/borrowers").send({ name: "No Account", email: "none@example.com" });

    const detail = await agent.get(`/api/borrowers/${loan.borrowerId}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      hasAccount: true,
      mustChangePassword: true,
      account: { id: account.id, email: "maria@example.com", role: { id: account.roleId, name: "Staff" }, active: true },
    });
    expect((await agent.get("/api/borrowers?hasAccount=true")).body.data.map((b: { name: string }) => b.name)).toEqual(["Maria Clara"]);
    expect((await agent.get("/api/borrowers?hasAccount=false")).body.data.map((b: { name: string }) => b.name)).toEqual(["No Account"]);

    // Changing or removing the borrower's email leaves the account (email, password, link) as it is.
    expect((await agent.patch(`/api/borrowers/${loan.borrowerId}`).send({ email: "maria.new@example.com" })).status).toBe(200);
    const removed = await agent.patch(`/api/borrowers/${loan.borrowerId}`).send({ email: "" });
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ email: null, hasAccount: true, account: { email: "maria@example.com" } });
    const after = (await accountOf(loan.borrowerId))!;
    expect(after).toMatchObject({ email: "maria@example.com", tokenVersion: account.tokenVersion });
    expect(after.passwordHash).toBe(account.passwordHash);
    expect((await signIn("maria@example.com", DEFAULT_PASSWORD)).res.status).toBe(200);
  });

  it("the borrower password reset endpoint is gone (accounts are reset in Users → Accounts)", async () => {
    const { agent } = await loginAs("all");
    const ana = await agent.post("/api/borrowers").send({ name: "Ana Santos", email: "ana@example.com" });
    const res = await agent.post(`/api/borrowers/${ana.body.id}/reset-password`).send({});
    expect(res.status).toBe(404);
    expect(await prisma.user.count({ where: { email: "ana@example.com" } })).toBe(0);
  });
});
