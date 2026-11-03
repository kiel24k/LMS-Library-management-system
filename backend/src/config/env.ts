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
  } as const;
}

export const env = loadEnv();
export type Env = typeof env;
