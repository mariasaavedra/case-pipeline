// =============================================================================
// health.ts — one-shot health check for the live deployment
// =============================================================================
// Prints a green/red summary of the things that mattered during the 2026-07
// incident: database integrity, schema, sync state, row counts, disk headroom,
// and how many backup restore points exist. Exits non-zero on a HARD failure
// (corruption, missing data, no schema, critically low disk) so it can drive a
// monitor; advisory WARNs do not fail the exit.
//
// Usage:
//   npm run health                         # checks data/live.db
//   docker compose exec api npm run health # on the server (cwd /app)
//   tsx scripts/health.ts --db=seed        # check seed.db instead
//
// Kept free of @case-pipeline/* imports so it is unit-testable by the root
// vitest config (same convention as backup-db.ts).
// =============================================================================

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type DatabaseInstance = InstanceType<typeof Database>;

export type CheckStatus = "pass" | "warn" | "fail";
export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}

const STALE_LOCK_MS = 35 * 60 * 1000; // a sync run should finish well within this
const STALE_SYNC_MS = 26 * 60 * 60 * 1000; // nightly runs daily; older is suspect

function integrityOk(db: DatabaseInstance): boolean {
  try {
    const rows = db.pragma("quick_check") as Array<{ quick_check: string }>;
    return rows.length === 1 && rows[0]?.quick_check === "ok";
  } catch {
    return false; // quick_check throws on a badly-malformed file
  }
}

function count(db: DatabaseInstance, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

/**
 * The database-level checks (everything except disk/backups, which need the
 * filesystem). Pure over an open read-only handle, so it is easy to unit-test.
 * `now` is injectable for deterministic time-based checks.
 */
export function runChecks(db: DatabaseInstance, now: number = Date.now()): Check[] {
  const checks: Check[] = [];

  // Integrity — the headline check.
  checks.push(
    integrityOk(db)
      ? { name: "integrity", status: "pass", detail: "quick_check ok" }
      : { name: "integrity", status: "fail", detail: "quick_check FAILED — database is corrupt" },
  );

  // Schema present. (The API enforces "current version" on startup; here we only
  // confirm a schema exists — version 0 means an unseeded/empty DB.)
  const hasSchema = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
    .get();
  const version = hasSchema
    ? ((db.prepare("SELECT version FROM schema_version").get() as { version: number } | undefined)?.version ?? 0)
    : 0;
  checks.push(
    version > 0
      ? { name: "schema", status: "pass", detail: `v${version}` }
      : { name: "schema", status: "fail", detail: "no schema — run the sync/seed first" },
  );

  // Sync advisory lock — free is good; held may be a running sync or a stale lock.
  const syncState = db
    .prepare("SELECT locked_by, locked_at, last_sync_at, last_sync_status FROM sync_state WHERE id = 1")
    .get() as
    | { locked_by: string | null; locked_at: string | null; last_sync_at: string | null; last_sync_status: string | null }
    | undefined;

  if (!syncState) {
    checks.push({ name: "sync lock", status: "warn", detail: "no sync_state row" });
  } else if (!syncState.locked_by) {
    checks.push({ name: "sync lock", status: "pass", detail: "free" });
  } else {
    const heldMs = syncState.locked_at ? now - new Date(syncState.locked_at).getTime() : 0;
    checks.push(
      heldMs > STALE_LOCK_MS
        ? { name: "sync lock", status: "warn", detail: `STALE lock held by ${syncState.locked_by} (${Math.round(heldMs / 60000)}m)` }
        : { name: "sync lock", status: "pass", detail: `held by ${syncState.locked_by} (sync running)` },
    );
  }

  // Last sync — flag a recorded corruption or a stale/never run.
  if (syncState?.last_sync_at) {
    const ageMs = now - new Date(syncState.last_sync_at).getTime();
    const ageStr = `${Math.round(ageMs / 3600000)}h ago`;
    if (syncState.last_sync_status === "corrupt") {
      checks.push({ name: "last sync", status: "fail", detail: `recorded CORRUPT at ${syncState.last_sync_at}` });
    } else if (ageMs > STALE_SYNC_MS) {
      checks.push({ name: "last sync", status: "warn", detail: `${syncState.last_sync_at} (${syncState.last_sync_status}), ${ageStr} — stale` });
    } else {
      checks.push({ name: "last sync", status: "pass", detail: `${syncState.last_sync_at} (${syncState.last_sync_status}), ${ageStr}` });
    }
  } else {
    checks.push({ name: "last sync", status: "warn", detail: "never run" });
  }

  // Row counts — key tables must not be empty (that means data loss).
  try {
    const profiles = count(db, "profiles");
    const contracts = count(db, "contracts");
    const boardItems = count(db, "board_items");
    const updates = count(db, "client_updates");
    const detail = `profiles ${profiles} · contracts ${contracts} · board_items ${boardItems} · updates ${updates}`;
    checks.push(
      profiles > 0 && boardItems > 0
        ? { name: "row counts", status: "pass", detail }
        : { name: "row counts", status: "fail", detail: `${detail} — a key table is EMPTY` },
    );
  } catch (err) {
    checks.push({ name: "row counts", status: "fail", detail: `query failed: ${(err as Error).message}` });
  }

  return checks;
}

// =============================================================================
// Filesystem checks + CLI (not exercised by the unit test)
// =============================================================================

function diskCheck(dir: string): Check {
  try {
    const s = fs.statfsSync(dir);
    const freeBytes = s.bavail * s.bsize;
    const totalBytes = s.blocks * s.bsize;
    const freeGb = freeBytes / 1e9;
    const usedPct = Math.round((1 - freeBytes / totalBytes) * 100);
    const detail = `${freeGb.toFixed(1)} GB free (${usedPct}% used)`;
    // A full sync needs ~1 GB of headroom (pre-sync backup + WAL). Running out
    // mid-write was the root cause of the 2026-07 corruptions.
    if (freeGb < 1) return { name: "disk", status: "fail", detail: `${detail} — CRITICALLY low` };
    if (freeGb < 3) return { name: "disk", status: "warn", detail: `${detail} — tight for a sync` };
    return { name: "disk", status: "pass", detail };
  } catch (err) {
    return { name: "disk", status: "warn", detail: `could not read: ${(err as Error).message}` };
  }
}

function backupsCheck(dataDir: string, source: string): Check {
  const dir = path.join(dataDir, "backups");
  try {
    const re = new RegExp(`^${source}-(\\d|presync).*\\.db(\\.enc)?$`);
    const n = fs.readdirSync(dir).filter((f) => re.test(f) && !f.includes("premigrate")).length;
    return n > 0
      ? { name: "backups", status: "pass", detail: `${n} restore point(s)` }
      : { name: "backups", status: "warn", detail: "no backups found" };
  } catch {
    return { name: "backups", status: "warn", detail: "no backups directory" };
  }
}

const ICON: Record<CheckStatus, string> = { pass: "✓", warn: "⚠", fail: "✗" };

async function main(): Promise<void> {
  const source = process.argv.slice(2).find((a) => a.startsWith("--db="))?.split("=")[1] ?? "live";
  const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data");
  const dbPath = path.join(dataDir, `${source}.db`);

  console.log(`Case Pipeline — health check (${source}.db)`);

  const checks: Check[] = [];
  if (!fs.existsSync(dbPath)) {
    checks.push({ name: "database", status: "fail", detail: `not found: ${dbPath}` });
  } else {
    const db = new Database(dbPath, { readonly: true });
    try {
      checks.push(...runChecks(db));
    } finally {
      db.close();
    }
  }
  checks.push(diskCheck(dataDir));
  checks.push(backupsCheck(dataDir, source));

  const pad = Math.max(...checks.map((c) => c.name.length));
  for (const c of checks) {
    console.log(`  ${ICON[c.status]} ${c.name.padEnd(pad)}  ${c.detail}`);
  }

  const failed = checks.some((c) => c.status === "fail");
  const warned = checks.some((c) => c.status === "warn");
  console.log(failed ? "\nFAIL" : warned ? "\nOK (with warnings)" : "\nPASS");
  process.exit(failed ? 1 : 0);
}

// Run the CLI only when invoked directly, not when imported by the test.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error("health check crashed:", err);
    process.exit(1);
  });
}
