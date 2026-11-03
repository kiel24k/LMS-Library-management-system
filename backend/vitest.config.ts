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
    },
  },
});
