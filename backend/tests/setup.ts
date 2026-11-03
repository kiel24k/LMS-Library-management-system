import { afterAll, beforeEach } from "vitest";
import { prisma } from "../src/lib/prisma.js";

const TABLES = ["ReturnRecordItem", "ReturnRecord", "LoanItem", "Loan", "Borrower", "BookCover", "Book", "Category", "Library", "User"];

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  await prisma.$disconnect();
});
