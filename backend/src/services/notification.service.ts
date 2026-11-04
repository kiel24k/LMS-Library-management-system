/**
 * The email a borrower gets when staff accept or reject their public borrow request. Always sent after the
 * decision is committed (never inside its transaction); the outcome is stored on the record (`notifiedAt` /
 * `notifyError`) and a failure never undoes the decision.
 */
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { formatLoanNumber } from "../lib/loan-number.js";
import { sendMail, senderFor } from "../lib/mailer.js";
import { getCompanyRow, type CompanyRow } from "./company.service.js";

const MAX_ERROR_LENGTH = 300;

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Escapes text for HTML element content and attribute values. Every interpolated value goes through this. */
export const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);

const dueDateFormat = new Intl.DateTimeFormat("en-GB", {
  // A due date is a calendar date stored as UTC midnight (already a day in APP_TIMEZONE): format it in UTC so it
  // never shifts by a day.
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
/** "Tuesday, 10 November 2026". */
export const formatDueDate = (d: Date) => dueDateFormat.format(d);

type DecisionLoan = {
  number: number;
  status: string;
  dueDate: Date | null;
  staffNotes: string | null;
  library: { name: string; location: string | null };
  borrower: { name: string; email: string };
  items: { quantity: number; book: { title: string; author: string | null } }[];
};

export type EmailContent = { subject: string; text: string; html: string };

/**
 * A text with links/values, rendered both as plain text and as escaped HTML. Parts are either plain strings or
 * `{ href }` links (the URL is shown as the link text).
 */
type Part = string | { href: string };
const asText = (parts: Part[]) => parts.map((p) => (typeof p === "string" ? p : p.href)).join("");
const asHtml = (parts: Part[]) =>
  parts.map((p) => (typeof p === "string" ? escapeHtml(p) : `<a href="${escapeHtml(p.href)}">${escapeHtml(p.href)}</a>`)).join("");

function bookLines(loan: DecisionLoan) {
  return loan.items.map((it) => {
    const author = it.book.author ? ` by ${it.book.author}` : "";
    const qty = it.quantity > 1 ? ` (${it.quantity} copies)` : "";
    return `${it.book.title}${author}${qty}`;
  });
}

function footerLines(company: CompanyRow) {
  const lines = [company.name];
  if (company.address) lines.push(...company.address.split(/\r?\n/).filter((l) => l.trim()));
  if (company.contactEmail) lines.push(`Email: ${company.contactEmail}`);
  if (company.contactPhone) lines.push(`Phone: ${company.contactPhone}`);
  return lines;
}

/**
 * The sign-in block of an acceptance email:
 * - "new-password": the account still has the default password (just created, or never changed since) → the
 *   email gives the sign-in page, their email and the default password;
 * - "existing": they have an account with their own password → just where to sign in;
 * - "none": no account (no default role was set when the request was accepted) → no sign-in block at all.
 */
export type SignInBlock = "new-password" | "existing" | "none";

/**
 * Builds the subject, plain-text and HTML body of the accept/reject email. Pure (no I/O). `signInEmail` is the
 * linked account's email: the one to sign in with, which can differ from the borrower's (editing a borrower never
 * changes the account); it falls back to the borrower's email.
 */
export function buildDecisionEmail(
  loan: DecisionLoan,
  company: CompanyRow,
  options: { signIn: SignInBlock; signInEmail?: string; publicUrl?: string; defaultPassword?: string },
): EmailContent {
  const publicUrl = options.publicUrl ?? env.appPublicUrl;
  const defaultPassword = options.defaultPassword ?? env.borrowerDefaultPassword;
  const ref = formatLoanNumber(loan.number);
  const accepted = loan.status !== "REJECTED";
  const loginUrl = `${publicUrl}/login`;
  const signInEmail = options.signInEmail ?? loan.borrower.email;
  const books = bookLines(loan);

  // Paragraphs (each a list of parts); a nested string[] is a bullet list.
  const blocks: (Part[] | { list: string[] })[] = [[`Hello ${loan.borrower.name},`]];
  if (accepted) {
    blocks.push([`Good news! Your borrow request ${ref} at ${loan.library.name} was accepted.`]);
    blocks.push(["Your books:"], { list: books });
    if (loan.dueDate) blocks.push([`Please return them by ${formatDueDate(loan.dueDate)}.`]);
    const where = loan.library.location ? `${loan.library.name} (${loan.library.location})` : loan.library.name;
    blocks.push([`You can pick them up at ${where}. Please bring your request number ${ref}.`]);
    if (options.signIn === "new-password") {
      blocks.push([
        "You can now sign in at ",
        { href: loginUrl },
        ` with your email ${signInEmail} and the default password: ${defaultPassword}`,
      ]);
      blocks.push(["Please change this password after you sign in."]);
    } else if (options.signIn === "existing") {
      blocks.push(["Sign in at ", { href: loginUrl }, ` with your email ${signInEmail} and your password to see your borrowed books.`]);
    }
  } else {
    blocks.push([`We're sorry, your borrow request ${ref} at ${loan.library.name} was not accepted.`]);
    blocks.push(["Books requested:"], { list: books });
    if (loan.staffNotes) blocks.push([`Reason: ${loan.staffNotes}`]);
    blocks.push(["If you have questions, please contact us."]);
  }
  const footer = footerLines(company);

  const text = [
    ...blocks.map((b) => ("list" in b ? b.list.map((l) => `- ${l}`).join("\n") : asText(b))),
    "--",
    footer.join("\n"),
  ].join("\n\n");

  const html = [
    '<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f2937">',
    ...blocks.map((b) =>
      "list" in b
        ? `<ul>${b.list.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`
        : `<p style="margin:0 0 12px">${asHtml(b)}</p>`,
    ),
    `<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0"><p style="margin:0;color:#6b7280;font-size:13px">${footer
      .map(escapeHtml)
      .join("<br>")}</p>`,
    "</body></html>",
  ].join("\n");

  const subject = `${company.name}: your borrow request ${ref} ${accepted ? "was accepted" : "was not accepted"}`;
  return { subject, text, html };
}

/** A short, single-line reason for `notifyError` (never the whole stack). */
function errorSummary(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const line = message.replace(/\s+/g, " ").trim() || "Unknown error";
  return line.length > MAX_ERROR_LENGTH ? `${line.slice(0, MAX_ERROR_LENGTH - 1)}…` : line;
}

/**
 * Sends the decision email of a borrow record whose borrower has an email (does nothing otherwise) and records the
 * outcome: success → `notifiedAt = now`, `notifyError = null`; failure → `notifyError` (logged, never thrown).
 * Call only after the decision has been committed.
 */
export async function sendDecisionEmail(loanId: string, options: { signIn: SignInBlock }): Promise<void> {
  const loan = await prisma.loan.findUnique({
    where: { id: loanId },
    select: {
      number: true,
      status: true,
      dueDate: true,
      staffNotes: true,
      library: { select: { name: true, location: true } },
      borrower: { select: { name: true, email: true, user: { select: { email: true } } } },
      items: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { quantity: true, book: { select: { title: true, author: true } } },
      },
    },
  });
  if (!loan?.borrower.email) return;
  const email = loan.borrower.email;
  let error: string | null = null;
  try {
    const company = await getCompanyRow();
    // Sign in with the linked account's email (it may differ from the borrower's after an edit).
    const signInEmail = loan.borrower.user?.email ?? email;
    const content = buildDecisionEmail({ ...loan, borrower: { name: loan.borrower.name, email } }, company, {
      ...options,
      signInEmail,
    });
    await sendMail({ from: senderFor(company.name), to: email, ...content });
  } catch (err) {
    error = errorSummary(err);
    console.error(`[mail] could not send the decision email for ${formatLoanNumber(loan.number)}:`, err);
  }
  try {
    await prisma.loan.update({
      where: { id: loanId },
      data: error === null ? { notifiedAt: new Date(), notifyError: null } : { notifyError: error },
    });
  } catch (err) {
    // The decision is already committed: never turn a bookkeeping failure into an error response.
    console.error(`[mail] could not record the email result for ${formatLoanNumber(loan.number)}:`, err);
  }
}
