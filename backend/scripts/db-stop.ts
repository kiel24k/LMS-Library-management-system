/**
 * `npm run db:stop` — cleanly stops the PostgreSQL server started by `npm run db:local`
 * (identified by its data directory backend/.pgdata, never by port).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPgBinaries } from "./pg-binaries.js";

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(backendDir, ".pgdata");

const { pg_ctl } = await loadPgBinaries();

if (!existsSync(path.join(dataDir, "postmaster.pid"))) {
  console.log("[db:stop] No server is running from .pgdata.");
  process.exit(0);
}
const res = spawnSync(pg_ctl, ["stop", "-D", dataDir, "-m", "fast", "-w", "-t", "60"], { stdio: "inherit" });
process.exit(res.status ?? 1);
