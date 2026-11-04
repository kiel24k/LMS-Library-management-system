/**
 * Outgoing email (accept/reject messages for public borrow requests).
 *
 * - With SMTP_HOST set: sent through that server (nodemailer), with ~10 s connection/greeting/socket timeouts so a
 *   slow or unreachable server cannot hang the request that triggered the email.
 * - Without it, nothing goes over the network: in development the message is printed to the console and the send
 *   FAILS (so the borrow record shows it was not sent); in tests (NODE_ENV=test, always, so a configured .env can
 *   never send real email from the test suite) it is appended to `testOutbox` and counts as sent.
 */
import nodemailer from "nodemailer";
import { env } from "../config/env.js";

export type MailAddress = { name: string; address: string };

export type MailMessage = {
  from: MailAddress | string;
  to: string;
  subject: string;
  text: string;
  html: string;
};

/** A message as recorded in `testOutbox` (`from` formatted as `"Name" <address>`). */
export type SentMail = Omit<MailMessage, "from"> & { from: string };

/** Delivers one message; rejects when it could not be handed over. */
export type MailTransport = (message: MailMessage) => Promise<void>;

const TIMEOUT_MS = 10_000;

/** Messages "sent" while NODE_ENV=test, oldest first. */
export const testOutbox: SentMail[] = [];

export function clearTestOutbox() {
  testOutbox.length = 0;
}

const formatFrom = (from: MailAddress | string) =>
  typeof from === "string" ? from : `"${from.name.replace(/["\\\r\n]/g, "")}" <${from.address}>`;

const outboxTransport: MailTransport = async (message) => {
  testOutbox.push({ ...message, from: formatFrom(message.from) });
};

/**
 * Prints the message, then fails: nothing reached the recipient, so the borrow record must show "not sent" (with this
 * reason) rather than "sent", and staff can resend once SMTP is configured.
 */
const consoleTransport: MailTransport = async (message) => {
  console.info(
    `[mail] (not sent: SMTP_HOST is not set)\nFrom: ${formatFrom(message.from)}\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n`,
  );
  throw new Error("Not sent: email (SMTP) is not set up on the server. The message was only printed to the server console.");
};

function smtpTransport(smtp: NonNullable<typeof env.smtp>): MailTransport {
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass ?? "" } : undefined,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });
  return async (message) => {
    await transporter.sendMail(message);
  };
}

let defaultTransport: MailTransport | undefined;
let testTransport: MailTransport | null = null;

/**
 * Test hook: replaces the transport (e.g. one that always fails) until called again with null. Only for tests;
 * production code never calls it.
 */
export function setMailTransportForTests(transport: MailTransport | null) {
  testTransport = transport;
}

function transport(): MailTransport {
  if (testTransport) return testTransport;
  defaultTransport ??=
    env.nodeEnv === "test" ? outboxTransport : env.smtp ? smtpTransport(env.smtp) : consoleTransport;
  return defaultTransport;
}

/**
 * The sender: MAIL_FROM when it holds an address (`"Name <a@b.c>"` or `a@b.c`). A MAIL_FROM with only a name
 * (`"Library Management"`), or no MAIL_FROM (the company name), is sent from SMTP_USER when that is an email address
 * (Gmail and most servers only accept their own account as sender), else from no-reply@localhost.
 */
export function senderFor(companyName: string): MailAddress | string {
  if (env.mailFrom?.includes("@")) return env.mailFrom;
  const user = env.smtp?.user;
  const address = user && /^[^\s@<>]+@[^\s@<>]+$/.test(user) ? user : "no-reply@localhost";
  return { name: env.mailFrom ?? companyName, address };
}

/** Sends one message (rejects with the transport's error when it could not be sent). */
export async function sendMail(message: MailMessage): Promise<void> {
  await transport()(message);
}
