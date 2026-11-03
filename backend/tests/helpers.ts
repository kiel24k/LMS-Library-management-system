import request from "supertest";
import type { Role } from "../src/generated/prisma/enums.js";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/services/user.service.js";

export const app = createApp({ rateLimit: false });
export const PASSWORD = "Password123!";

let seq = 0;
const next = () => ++seq;

export async function createUser(role: Role = "STAFF", overrides: { email?: string; name?: string; active?: boolean } = {}) {
  const n = next();
  return prisma.user.create({
    data: {
      email: overrides.email ?? `user${n}@test.local`,
      name: overrides.name ?? `${role === "ADMIN" ? "Admin" : "Staff"} ${n}`,
      role,
      active: overrides.active ?? true,
      passwordHash: await hashPassword(PASSWORD),
    },
  });
}

/** A supertest agent (cookie jar) logged in as a new user with `role`. */
export async function loginAs(role: Role = "STAFF", appInstance = app) {
  const user = await createUser(role);
  const agent = request.agent(appInstance);
  const res = await agent.post("/api/auth/login").send({ email: user.email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, user };
}

export async function createLibrary(overrides: Partial<{ name: string; slug: string; publicFormEnabled: boolean; defaultLoanDays: number }> = {}) {
  const n = next();
  return prisma.library.create({
    data: {
      name: overrides.name ?? `Library ${n}`,
      slug: overrides.slug ?? `library-${n}`,
      publicFormEnabled: overrides.publicFormEnabled ?? false,
      defaultLoanDays: overrides.defaultLoanDays ?? 7,
    },
  });
}

export async function createBook(libraryId: string, overrides: Partial<{ title: string; totalCopies: number; archived: boolean; categoryId: string }> = {}) {
  const n = next();
  const total = overrides.totalCopies ?? 1;
  return prisma.book.create({
    data: {
      libraryId,
      title: overrides.title ?? `Book ${n}`,
      totalCopies: total,
      availableCopies: total,
      archived: overrides.archived ?? false,
      categoryId: overrides.categoryId ?? null,
    },
  });
}

export async function getBook(id: string) {
  return prisma.book.findUniqueOrThrow({ where: { id } });
}

/** Staff-creates a BORROWED loan via the API and returns the LoanDetail body. */
export async function staffLoan(
  agent: ReturnType<typeof request.agent>,
  libraryId: string,
  items: { bookId: string; quantity: number }[],
  borrower: { name: string; idNumber?: string } = { name: "Juan Dela Cruz" },
) {
  const res = await agent.post("/api/loans").send({ libraryId, borrower, items });
  if (res.status !== 201) throw new Error(`loan failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function publicRequest(slug: string, items: { bookId: string; quantity: number }[], borrower: { name: string; idNumber?: string } = { name: "Maria Clara" }) {
  const res = await request(app).post(`/api/public/libraries/${slug}/requests`).send({ borrower, items });
  if (res.status !== 201) throw new Error(`request failed: ${res.status} ${JSON.stringify(res.body)}`);
  const number = Number(String(res.body.loanNumber).replace("BR-", ""));
  return prisma.loan.findUniqueOrThrow({ where: { number } });
}
