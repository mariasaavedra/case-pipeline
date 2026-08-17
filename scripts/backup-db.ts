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

/**
 * Full-scan structural check. Returns true only when SQLite reports "ok".
 * quick_check THROWS on a badly-malformed file (not just returns error rows), so
 * the throw is caught and treated as unhealthy. Kept local so this script stays
 * free of workspace-alias imports (it is unit-tested by the root vitest config).
 */
function sourceIsHealthy(db: DatabaseInstance): boolean {
  try {
    const rows = db.pragma("quick_check") as Array<{ quick_check: string }>;
    return rows.length === 1 && rows[0]?.quick_check === "ok";
  } catch {
    return false;
  }
}

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
  const keep = opts.keep ?? (Number(process.env.BACKUP_KEEP) || 4);
  const dataDir = opts.dataDir ?? defaultDataDir();
  const label = opts.label ?? source;
  const srcPath = path.join(dataDir, `${source}.db`);

  if (!opts.existing && !fs.existsSync(srcPath)) return null;

  const backupDir = path.join(dataDir, "backups");
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destPath = path.join(backupDir, `${label}-${stamp}.db`);

  const db = opts.existing ?? new Database(srcPath, { readonly: true });
  let sourceHealthy = true;
  try {
    // Is the SOURCE sound before we let this backup age out older ones? On
    // 2026-07-24 the daily backup faithfully copied an already-corrupt live.db;
    // had that kept pruning, every good restore point would have aged out. A
    // corrupt source still gets backed up (it's evidence, and .backup() may well
    // succeed on it — that is how the poisoning happened), but must NOT be
    // allowed to prune the last-known-good backups.
    sourceHealthy = sourceIsHealthy(db);
    await db.backup(destPath);
  } finally {
    if (!opts.existing) db.close();
  }

  if (!sourceHealthy) {
    console.warn(
      `⚠ ${source}.db failed its integrity check — backup written for evidence, ` +
        `but pruning is SKIPPED so no known-good backup is lost.`,
    );
    return destPath;
  }

  // Prune older backups of THIS label. The pattern requires a digit right after
  // "label-" (the ISO year) so the "live" series never swallows "live-presync":
  // "live-2026-…" matches /^live-\d/, "live-presync-2026-…" does not.
  //
  // The `.enc` suffix is NOT optional decoration — omitting it is what filled a
  // 48 GB disk on 2026-08-17. Backups are encrypted by the caller AFTER this
  // function returns, so on a server with BACKUP_ENCRYPTION_KEY set every file
  // already on disk is `…​.db.enc` and matched nothing. The prune ran daily,
  // found zero candidates, and reported success while thirteen 1.5 GB backups
  // accumulated. Retention had been a no-op in production for weeks.
  const re = new RegExp(`^${label}-\\d.*\\.db(\\.enc)?$`);
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
  // 4 by default: at ~820 MB per live backup, more than a handful fills a small
  // disk, which was the root cause of the 2026-07 corruptions. Override with --keep.
  let keep = Number(process.env.BACKUP_KEEP) || 4;
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
