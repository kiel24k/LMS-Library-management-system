import "dotenv/config";

/**
 * The database the automated tests run against: TEST_DATABASE_URL, or else the app's own DATABASE_URL
 * (the project uses a single database, `lms`). Tests truncate every table, and the global teardown
 * empties it again and re-runs the seed, so afterwards only the admin account is left.
 */
export function testDatabaseUrl(): string {
  const raw = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!raw) throw new Error("Set DATABASE_URL (or TEST_DATABASE_URL) to run the tests.");
  return raw;
}
