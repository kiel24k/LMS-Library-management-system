import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { testDatabaseUrl } from "./db-url.js";

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TABLES = ["ReturnRecordItem", "ReturnRecord", "LoanItem", "Loan", "Borrower", "BookCover", "Book", "Category", "Library", "User"];

/**
 * Applies all migrations to the database before the run. The returned teardown empties every table
 * after the run and re-runs the seed, so the database is left with just the admin account
 * (admin@localhost / password123).
 */
export default async function setup() {
  const env = { ...process.env, DATABASE_URL: testDatabaseUrl() };
  execSync("npx prisma migrate deploy", { cwd: backendDir, env, stdio: "pipe" });

  return async function teardown() {
    const client = new pg.Client({ connectionString: env.DATABASE_URL });
    await client.connect();
    try {
      await client.query(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
    } finally {
      await client.end();
    }
    execSync("npx tsx prisma/seed.ts", { cwd: backendDir, env, stdio: "pipe" });
  };
}
