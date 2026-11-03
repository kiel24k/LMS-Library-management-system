/**
 * `npm run db:local` — runs a real PostgreSQL server for development without a system-wide install.
 *
 * - Binaries come from the `embedded-postgres` npm package (PostgreSQL 18, per-platform package).
 * - Data lives in `backend/.pgdata/` (git-ignored); it is created with `initdb` on first run.
 * - Listens on localhost:5432 (override with DB_LOCAL_PORT), user `postgres` / password `postgres`.
 * - Creates the database `lms` if it is missing.
 * - Ctrl+C (or `npm run db:stop` from another terminal) performs a clean "fast" shutdown via pg_ctl.
 *
 * It never stops or kills anything it did not start: if the port is already taken, it reports and exits.
 * DB_LOCAL_PORT may be set in the environment or in backend/.env (keep DATABASE_URL on the same port).
 */
import "dotenv/config";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadPgBinaries } from "./pg-binaries.js";

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(backendDir, ".pgdata");
const port = Number(process.env.DB_LOCAL_PORT ?? 5432);
const USER = "postgres";
const PASSWORD = "postgres";
const DATABASES = ["lms"];

function log(msg: string) {
  console.log(`[db:local] ${msg}`);
}

/** Resolves true when something accepts TCP connections on host:port. */
function isListening(host: string, p: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port: p });
    const done = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(1000);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function runningPostmasterPid(): number | null {
  const pidFile = path.join(dataDir, "postmaster.pid");
  if (!existsSync(pidFile)) return null;
  const pid = Number(readFileSync(pidFile, "utf8").split(/\r?\n/)[0]);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0); // existence check only, sends no signal
    return pid;
  } catch {
    return null; // stale pid file left by a crash; postgres handles it on start
  }
}

async function initialiseCluster() {
  log(`Initialising a new cluster in ${dataDir} ...`);
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const ep = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: USER,
    password: PASSWORD,
    port,
    authMethod: "scram-sha-256",
    persistent: true,
    // ICU collation: natural, case-insensitive-first ordering ("alpha" < "Bravo"), identical on every OS.
    initdbFlags: ["--encoding=UTF8", "--locale=C", "--locale-provider=icu", "--icu-locale=en-US"],
    onLog: () => {},
    onError: (e) => console.error(e),
  });
  await ep.initialise();
  log("Cluster initialised.");
}

async function ensureDatabases() {
  const client = new pg.Client({ host: "localhost", port, user: USER, password: PASSWORD, database: "postgres" });
  await client.connect();
  try {
    for (const name of DATABASES) {
      const res = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
      if (res.rowCount === 0) {
        await client.query(`CREATE DATABASE ${client.escapeIdentifier(name)}`);
        log(`Created database "${name}".`);
      }
    }
  } finally {
    await client.end();
  }
}

async function main() {
  const { postgres, pg_ctl } = await loadPgBinaries();

  const existingPid = runningPostmasterPid();
  if (existingPid !== null) {
    log(`A PostgreSQL server is already running from ${dataDir} (pid ${existingPid}). Nothing to do.`);
    log(`Stop it with "npm run db:stop" if you want to restart it.`);
    process.exit(1);
  }

  if ((await isListening("127.0.0.1", port)) || (await isListening("::1", port))) {
    log(`Port ${port} is already in use by another process (for example a system-wide PostgreSQL service).`);
    log(`This script never stops processes it did not start. Either use that server (set DATABASE_URL`);
    log(`accordingly), stop it yourself, or run on another port: DB_LOCAL_PORT=5433 npm run db:local`);
    log(`(and point DATABASE_URL at that port).`);
    process.exit(1);
  }

  if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
    await initialiseCluster();
  }

  log(`Starting PostgreSQL on localhost:${port} (data: ${dataDir}) ...`);
  const child: ChildProcess = spawn(
    postgres,
    ["-D", dataDir, "-p", String(port), "-c", "listen_addresses=localhost"],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LC_MESSAGES: "C" } },
  );

  let stopping = false;
  let ready = false;

  const onOutput = (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    for (const line of text.split(/\r?\n/)) if (line.trim()) console.log(`[postgres] ${line}`);
    if (!ready && text.includes("database system is ready to accept connections")) {
      ready = true;
      void onReady();
    }
  };
  child.stdout?.on("data", onOutput);
  child.stderr?.on("data", onOutput);

  const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));

  async function onReady() {
    try {
      await ensureDatabases();
      log(`Ready: postgresql://${USER}:${PASSWORD}@localhost:${port}/lms`);
      log("Press Ctrl+C to stop.");
    } catch (err) {
      console.error("[db:local] Failed to create databases:", err);
    }
  }

  async function shutdown(signal: string) {
    if (stopping) return;
    stopping = true;
    log(`${signal} received, shutting down PostgreSQL (fast) ...`);
    if (child.exitCode === null) {
      // pg_ctl sends the proper shutdown signal on every platform (on Windows it uses the
      // postmaster's signal pipe). On Ctrl+C in a console postgres may already be shutting down
      // by itself; then pg_ctl simply reports it and we keep waiting for the child to exit.
      spawnSync(pg_ctl, ["stop", "-D", dataDir, "-m", "fast", "-w", "-t", "60"], { stdio: "ignore" });
    }
    const code = await exited;
    log(`PostgreSQL stopped (exit code ${code ?? "n/a"}).`);
    process.exit(0);
  }

  for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"] as const) {
    process.on(sig, () => void shutdown(sig));
  }

  const code = await exited;
  if (!stopping) {
    log(`PostgreSQL exited (code ${code ?? "n/a"}).`);
    process.exit(ready && code === 0 ? 0 : 1);
  }
}

main().catch((err) => {
  console.error("[db:local]", err instanceof Error ? err.message : err);
  process.exit(1);
});
