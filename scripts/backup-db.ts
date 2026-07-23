// =============================================================================
// Database backup — snapshot live.db (or seed.db) to data/backups/
// =============================================================================
// In a Docker deployment, data/live.db is the only copy of real client data, so
// it must be backed up. Uses better-sqlite3's online backup API, which is safe
// to run while the API is reading from the database (no downtime).
//
// backupDatabase() is the reusable core: the CLI below calls it, and so does the
// sync (scripts/sync/index.ts) to snapshot live.db BEFORE its destructive
// resetDatabase() — so a wipe always has a fallback right behind it.
//
// Usage:
//   npm run backup:live                 # back up data/live.db
//   tsx scripts/backup-db.ts --db=seed  # back up data/seed.db
//   tsx scripts/backup-db.ts --keep=10  # prune to the 10 most recent backups
// =============================================================================

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type DatabaseInstance = InstanceType<typeof Database>;

export function defaultDataDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data");
}

export interface BackupOptions {
  /** Which DB file: "live" → live.db, "seed" → seed.db. Default "live". */
  source?: string;
  /** How many backups of THIS label to retain; older ones are pruned. Default 14. */
  keep?: number;
  /** Data directory holding the .db files and backups/. Default: repo data/. */
  dataDir?: string;
  /**
   * Filename prefix for this backup, so different backup kinds retain
   * independently. Default = `source`. The sync uses "live-presync" for its
   * pre-reset safety copies, kept separate from the daily "live" series.
   */
  label?: string;
  /**
   * Reuse an already-open connection for the online backup instead of opening a
   * second read-only handle. The sync passes its live handle so it snapshots the
   * exact on-disk state it is about to reset.
   */
  existing?: DatabaseInstance;
}

/**
 * Snapshot a database to data/backups/, then prune older backups of the same
 * label beyond `keep`. Returns the backup path, or null when there is nothing
 * to back up (the source file does not exist and no open handle was given).
 */
export async function backupDatabase(opts: BackupOptions = {}): Promise<string | null> {
  const source = opts.source ?? "live";
  const keep = opts.keep ?? 14;
  const dataDir = opts.dataDir ?? defaultDataDir();
  const label = opts.label ?? source;
  const srcPath = path.join(dataDir, `${source}.db`);

  if (!opts.existing && !fs.existsSync(srcPath)) return null;

  const backupDir = path.join(dataDir, "backups");
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destPath = path.join(backupDir, `${label}-${stamp}.db`);

  const db = opts.existing ?? new Database(srcPath, { readonly: true });
  try {
    await db.backup(destPath);
  } finally {
    if (!opts.existing) db.close();
  }

  // Prune older backups of THIS label. The pattern requires a digit right after
  // "label-" (the ISO year) so the "live" series never swallows "live-presync":
  // "live-2026-…" matches /^live-\d/, "live-presync-2026-…" does not.
  const re = new RegExp(`^${label}-\\d.*\\.db$`);
  const backups = fs
    .readdirSync(backupDir)
    .filter((f) => re.test(f))
    .sort(); // ISO timestamps sort lexicographically = chronologically
  for (const f of backups.slice(0, Math.max(0, backups.length - keep))) {
    fs.unlinkSync(path.join(backupDir, f));
    console.log(`Pruned old backup: ${f}`);
  }

  return destPath;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let source = "live";
  let keep = 14; // ~2 weeks of daily backups by default
  for (const arg of args) {
    if (arg.startsWith("--db=")) source = arg.split("=")[1] ?? source;
    else if (arg.startsWith("--keep=")) keep = parseInt(arg.split("=")[1] ?? "") || keep;
  }
  return { source, keep };
}

async function main() {
  const { source, keep } = parseArgs();
  const dataDir = defaultDataDir();
  const srcPath = path.join(dataDir, `${source}.db`);

  if (!fs.existsSync(srcPath)) {
    console.error(`Database not found: ${srcPath}`);
    process.exit(1);
  }

  const destPath = await backupDatabase({ source, keep, dataDir });
  const sizeMb = (fs.statSync(destPath!).size / 1024 / 1024).toFixed(2);
  console.log(`Backup written: ${destPath} (${sizeMb} MB)`);
}

// Only run the CLI when invoked directly, not when imported for backupDatabase().
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error("Backup failed:", err);
    process.exit(1);
  });
}
