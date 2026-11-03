/** Locates the PostgreSQL binaries shipped by the per-platform `@embedded-postgres/*` package. */
export async function loadPgBinaries(): Promise<{ postgres: string; pg_ctl: string; initdb: string }> {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const pkg = `@embedded-postgres/${platform}-${process.arch}`;
  try {
    return (await import(pkg)) as { postgres: string; pg_ctl: string; initdb: string };
  } catch {
    throw new Error(`PostgreSQL binaries for ${platform}-${process.arch} are not installed (${pkg}). Run "npm install" in backend/ first.`);
  }
}
