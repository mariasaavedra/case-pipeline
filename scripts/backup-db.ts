// =============================================================================
// Database backup — snapshot live.db (or seed.db) to data/backups/
// =============================================================================
// In a Docker deployment, data/live.db is the only copy of real client data, so
// it must be backed up. Uses better-sqlite3's online backup API, which is safe
// to run while the API is reading from the database (no downtime).
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
  const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data");
  const srcPath = path.join(dataDir, `${source}.db`);

  if (!fs.existsSync(srcPath)) {
    console.error(`Database not found: ${srcPath}`);
    process.exit(1);
  }

  const backupDir = path.join(dataDir, "backups");
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destPath = path.join(backupDir, `${source}-${stamp}.db`);

  const db = new Database(srcPath, { readonly: true });
  try {
    await db.backup(destPath);
  } finally {
    db.close();
  }

  const sizeMb = (fs.statSync(destPath).size / 1024 / 1024).toFixed(2);
  console.log(`Backup written: ${destPath} (${sizeMb} MB)`);

  // Prune oldest backups for this source beyond --keep
  const backups = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith(`${source}-`) && f.endsWith(".db"))
    .sort(); // ISO timestamps sort lexicographically = chronologically
  const stale = backups.slice(0, Math.max(0, backups.length - keep));
  for (const f of stale) {
    fs.unlinkSync(path.join(backupDir, f));
    console.log(`Pruned old backup: ${f}`);
  }
}

main().catch((err) => {
  console.error("Backup failed:", err);
  process.exit(1);
});
