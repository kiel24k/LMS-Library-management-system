import { afterAll, beforeEach } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { clearTestOutbox, setMailTransportForTests } from "../src/lib/mailer.js";

const TABLES = [
  "ReturnRecordItem",
  "ReturnRecord",
  "LoanItem",
  "Loan",
  "Borrower",
  "BookCover",
  "Book",
  "Category",
  "Library",
  "User",
  "Role",
  "CompanyProfile",
];

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
  // Every test starts with the company profile the migration creates (default name, no logo).
  await prisma.companyProfile.create({ data: { id: 1 } });
  clearTestOutbox();
  setMailTransportForTests(null);
});

afterAll(async () => {
  await prisma.$disconnect();
});
