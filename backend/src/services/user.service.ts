import bcrypt from "bcryptjs";
import type { Role } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import { HttpError, notFound } from "../lib/http-error.js";
import { isUniqueViolation } from "../lib/prisma-errors.js";
import { userSelect } from "../middleware/auth.js";
import { serializeUser } from "./serializers.js";

export const BCRYPT_COST = 10;
export const hashPassword = (pw: string) => bcrypt.hash(pw, BCRYPT_COST);

export async function listUsers() {
  const rows = await prisma.user.findMany({ select: userSelect, orderBy: [{ name: "asc" }, { email: "asc" }] });
  return { data: rows.map(serializeUser) };
}

export async function createUser(input: { email: string; name: string; password: string; role: Role }) {
  try {
    const u = await prisma.user.create({
      data: { email: input.email, name: input.name, role: input.role, passwordHash: await hashPassword(input.password) },
      select: userSelect,
    });
    return serializeUser(u);
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, "EMAIL_TAKEN", "An account with this email already exists.");
    throw err;
  }
}

export async function updateUser(
  id: string,
  input: { name?: string; role?: Role; active?: boolean; password?: string },
  actorId: string,
) {
  if (id === actorId && (input.active === false || input.role === "STAFF")) {
    throw new HttpError(409, "SELF_MODIFICATION", "You cannot deactivate or demote your own account.");
  }
  const passwordHash = input.password !== undefined ? await hashPassword(input.password) : undefined;
  const u = await prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id }, select: { role: true, active: true } });
    if (!target) throw notFound("User");
    const losesAdmin =
      target.role === "ADMIN" && target.active && (input.active === false || input.role === "STAFF");
    if (losesAdmin) {
      // Lock all active admin rows so two concurrent demotions cannot both pass the check.
      const admins = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "User" WHERE "role" = 'ADMIN' AND "active" = true FOR UPDATE`;
      if (admins.filter((a) => a.id !== id).length === 0) {
        throw new HttpError(409, "LAST_ADMIN", "There must always be at least one active administrator.");
      }
    }
    // A password reset or deactivation signs the user out everywhere (invalidates all their tokens).
    const revokeSessions = passwordHash !== undefined || input.active === false;
    return tx.user.update({
      where: { id },
      data: {
        name: input.name,
        role: input.role,
        active: input.active,
        passwordHash,
        ...(revokeSessions ? { tokenVersion: { increment: 1 } } : {}),
      },
      select: { ...userSelect, tokenVersion: true },
    });
  });
  return { user: serializeUser(u), tokenVersion: u.tokenVersion };
}
