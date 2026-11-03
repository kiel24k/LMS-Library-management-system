import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "../config/env.js";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: env.databaseUrl });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (!env.isProduction) {
  globalForPrisma.prisma = prisma;
}

/** Transaction client type (the `tx` passed to interactive transactions). */
export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
/** Either the root client or a transaction client. */
export type Db = typeof prisma | Tx;

/** Options for interactive transactions that touch stock (allow queueing under contention). */
export const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;
