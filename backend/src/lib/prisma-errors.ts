import { Prisma } from "../generated/prisma/client.js";

/** True when `err` is a unique-constraint violation (optionally mentioning `field`). */
export function isUniqueViolation(err: unknown, field?: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  if (!field) return true;
  const text = JSON.stringify(err.meta ?? {}) + err.message;
  return text.includes(field);
}

export function isRecordNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";
}

/** True for a foreign-key violation (e.g. deleting a row that is still referenced). */
export function isForeignKeyViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003";
}

/** True when a transaction failed because of a write conflict or deadlock (safe to retry). */
export function isTransactionConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034";
}
