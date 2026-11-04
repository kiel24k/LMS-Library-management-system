import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { ALL_PERMISSIONS, DEFAULT_STAFF_PERMISSIONS, type Permission } from "../src/lib/permissions.js";
import { hashPassword } from "../src/services/user.service.js";

export const app = createApp({ rateLimit: false });
export const PASSWORD = "Password123!";

let seq = 0;
const next = () => ++seq;
let roleSeq = 0;

/** A permission list, or "all" (≈ the old ADMIN) / "staff" (the default Staff role, ≈ the old STAFF). */
export type PermissionSet = readonly Permission[] | "all" | "staff";

const resolve = (set: PermissionSet): Permission[] =>
  set === "all" ? [...ALL_PERMISSIONS] : set === "staff" ? [...DEFAULT_STAFF_PERMISSIONS] : [...set];

/** A new role holding exactly `permissions` (stored as given, not normalized). */
export async function createRole(permissions: PermissionSet = "staff", name?: string) {
  return prisma.role.create({ data: { name: name ?? `Role ${++roleSeq}`, permissions: resolve(permissions) } });
}

export async function createUser(
  options: { permissions?: PermissionSet; roleId?: string; email?: string; name?: string; active?: boolean } = {},
) {
  const n = next();
  const permissions = options.permissions ?? "staff";
  const roleId = options.roleId ?? (await createRole(permissions)).id;
  return prisma.user.create({
    data: {
      email: options.email ?? `user${n}@test.local`,
      name: options.name ?? `${permissions === "all" ? "Admin" : "Staff"} ${n}`,
      roleId,
      active: options.active ?? true,
      passwordHash: await hashPassword(PASSWORD),
    },
  });
}

/** A supertest agent (cookie jar) logged in as a new user whose new role holds `permissions`. */
export async function loginAs(permissions: PermissionSet = "staff", appInstance = app) {
  const user = await createUser({ permissions });
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

export type PublicBorrower = { name: string; email?: string; idNumber?: string; contact?: string; affiliation?: string };

/**
 * The email a public request is sent with when the test gives none: derived from the ID number (so repeated
 * requests with one ID number stay the same borrower) or from the name.
 */
export const defaultEmailFor = (b: PublicBorrower) =>
  b.email ?? `${(b.idNumber ?? b.name).toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "") || "borrower"}@example.com`;

/** Submits a public borrow request (an email is added when `borrower` has none) and returns the loan row. */
export async function publicRequest(slug: string, items: { bookId: string; quantity: number }[], borrower: PublicBorrower = { name: "Maria Clara" }) {
  const res = await request(app)
    .post(`/api/public/libraries/${slug}/requests`)
    .send({ borrower: { ...borrower, email: defaultEmailFor(borrower) }, items });
  if (res.status !== 201) throw new Error(`request failed: ${res.status} ${JSON.stringify(res.body)}`);
  const number = Number(String(res.body.loanNumber).replace("BR-", ""));
  return prisma.loan.findUniqueOrThrow({ where: { number } });
}

/** Signs in with an email + password (staff or borrower) and returns the agent and response. */
export async function signIn(email: string, password: string, appInstance = app) {
  const agent = request.agent(appInstance);
  const res = await agent.post("/api/auth/login").send({ email, password });
  return { agent, res };
}
