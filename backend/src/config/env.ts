import "dotenv/config";
import { z } from "zod";

const DEV_JWT_SECRET = "dev-only-insecure-jwt-secret-change-me-0123456789";

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const blankToUndefined = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CORS_ORIGIN: z
    .string()
    .default("http://localhost:5174")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  JWT_SECRET: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : undefined)),
  // Optional Express "trust proxy" setting when running behind a reverse proxy (e.g. "1", "loopback").
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v) => {
      if (!v || !v.trim()) return undefined;
      const t = v.trim();
      if (t === "true") return true as const;
      if (t === "false") return false as const;
      return /^\d+$/.test(t) ? Number(t) : t;
    }),
  APP_TIMEZONE: z.string().default("Asia/Manila").refine(isValidTimeZone, "APP_TIMEZONE is not a valid IANA time zone"),
  // Base URL of the frontend, used for links in emails (sign-in page). No trailing slash needed.
  APP_PUBLIC_URL: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : "http://localhost:5174"))
    .refine((v) => /^https?:\/\/[^\s]+$/.test(v), "APP_PUBLIC_URL must be an http(s) URL")
    .transform((v) => v.replace(/\/+$/, "")),
  // The first password of the account created when a borrower's request is accepted (sent in the acceptance email;
  // they must change it, and a forced change can never pick it again).
  BORROWER_DEFAULT_PASSWORD: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : "password123"))
    .refine((v) => v.length >= 8 && Buffer.byteLength(v, "utf8") <= 72, "BORROWER_DEFAULT_PASSWORD must be 8 characters – 72 bytes"),
  // Outgoing email (accept/reject messages). Without SMTP_HOST nothing is sent over the network (see src/lib/mailer.ts).
  SMTP_HOST: blankToUndefined,
  SMTP_PORT: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.coerce.number().int().min(1).max(65535).default(587)),
  // Case-insensitive ("FALSE" works too).
  SMTP_SECURE: z
    .preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.enum(["true", "false", ""], { error: 'SMTP_SECURE must be "true" or "false"' }))
    .optional()
    .transform((v) => v === "true"),
  SMTP_USER: blankToUndefined,
  SMTP_PASS: z.string().optional().transform((v) => (v ? v : undefined)),
  // Sender, e.g. "Parish Library <library@example.org>". Default: "<company name> <no-reply@localhost>".
  MAIL_FROM: blankToUndefined,
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    console.error(`Invalid environment configuration:\n${lines.join("\n")}`);
    process.exit(1);
  }
  const env = parsed.data;
  let jwtSecret = env.JWT_SECRET;
  if (env.NODE_ENV === "production") {
    if (!jwtSecret || jwtSecret.length < 32) {
      // Fail fast: never run production with a missing or guessable secret.
      console.error("JWT_SECRET must be set (at least 32 characters) when NODE_ENV=production.");
      process.exit(1);
    }
  } else if (!jwtSecret) {
    if (env.NODE_ENV !== "test") {
      console.warn("[env] JWT_SECRET is not set; using an insecure development default. Never do this in production.");
    }
    jwtSecret = DEV_JWT_SECRET;
  }
  return {
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === "production",
    databaseUrl: env.DATABASE_URL,
    port: env.PORT,
    corsOrigins: env.CORS_ORIGIN,
    jwtSecret,
    appTimezone: env.APP_TIMEZONE,
    trustProxy: env.TRUST_PROXY as boolean | number | string | undefined,
    appPublicUrl: env.APP_PUBLIC_URL,
    borrowerDefaultPassword: env.BORROWER_DEFAULT_PASSWORD,
    smtp: env.SMTP_HOST
      ? { host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, user: env.SMTP_USER, pass: env.SMTP_PASS }
      : undefined,
    mailFrom: env.MAIL_FROM,
  } as const;
}

export const env = loadEnv();
export type Env = typeof env;
