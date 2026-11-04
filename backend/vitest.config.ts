import { defineConfig } from "vitest/config";
import { testDatabaseUrl } from "./tests/db-url.js";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/setup.ts"],
    // One shared database: run test files one after another.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testDatabaseUrl(),
      JWT_SECRET: "test-secret-0123456789-0123456789-0123456789",
      APP_TIMEZONE: "Asia/Manila",
      CORS_ORIGIN: "http://localhost:5173",
      // Fixed values so email assertions do not depend on a developer's .env (tests never send real email anyway).
      APP_PUBLIC_URL: "http://localhost:5174",
      BORROWER_DEFAULT_PASSWORD: "password123",
      MAIL_FROM: "",
      SMTP_HOST: "",
      SMTP_USER: "",
      SMTP_PASS: "",
    },
  },
});
