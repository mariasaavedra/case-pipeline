// =============================================================================
// Backup series pruning
// =============================================================================
// The pre-migration snapshots taken by the API (server.ts and db/users-db.ts)
// are written straight to data/backups/ with VACUUM INTO, bypassing
// scripts/backup-db.ts and therefore its retention entirely. Nothing ever
// deleted them. On 2026-08-17 that series alone held four ~1.2 GB copies of
// live.db, one per schema version since v16, on a disk that had reached 100%.
//
// This lives in the app rather than being imported from scripts/backup-db.ts on
// purpose: that file documents itself as free of workspace-alias imports so the
// root vitest config can unit-test it. Reaching across that boundary in the
// other direction (app → scripts) would be worse than a small, tested helper.
//
// Two things this handles that a naive prune does not:
//
//   1. `.db.enc`. Snapshots are encrypted after being written, so by the time a
//      later run looks for them they no longer end in `.db`. A pattern that
//      missed that suffix is exactly what made the other retention path a
//      silent no-op for weeks.
//   2. Sorting. These filenames carry a version segment before the timestamp
//      ("live-premigrate-v9-2026-…", "live-premigrate-v16-2026-…"), so a plain
//      lexicographic sort puts v16 before v9 and prunes the WRONG end of the
//      series. Ordering is by the embedded ISO stamp instead.
// =============================================================================

import fs from "node:fs";
import path from "node:path";

/** The ISO stamp embedded by the snapshot writers, e.g. 2026-08-06T17-04-25-452Z. */
const STAMP_RE = /(\d{4}-\d{2}-\d{2}T[\d-]+Z)/;

/** Sort key for a backup filename: its timestamp, or the name when absent. */
function stampOf(filename: string): string {
  return STAMP_RE.exec(filename)?.[1] ?? filename;
}

/**
 * Delete all but the `keep` most recent files in `backupDir` matching `pattern`.
 * Returns the filenames removed.
 *
 * Never throws: a failed prune must not take down a migration or a boot. It is
 * housekeeping, and losing it costs disk — losing the startup costs the app.
 */
export function pruneBackupSeries(
  backupDir: string,
  pattern: RegExp,
  keep: number,
): string[] {
  if (keep < 1) return [];
  const removed: string[] = [];
  try {
    const files = fs
      .readdirSync(backupDir)
      .filter((f) => pattern.test(f))
      .sort((a, b) => stampOf(a).localeCompare(stampOf(b)));

    for (const f of files.slice(0, Math.max(0, files.length - keep))) {
      try {
        fs.unlinkSync(path.join(backupDir, f));
        removed.push(f);
      } catch (err) {
        console.warn(`[backup] could not prune ${f}:`, err);
      }
    }
  } catch (err) {
    console.warn("[backup] prune skipped:", err);
    return removed;
  }
  if (removed.length > 0) {
    console.log(`[backup] Pruned ${removed.length} old snapshot(s): ${removed.join(", ")}`);
  }
  return removed;
}

/**
 * Pattern matching one pre-migration series, e.g. `live-premigrate-v21-…`.
 * The version is part of the name but NOT part of the series identity — the
 * point of retention here is "keep the last N snapshots", across versions.
 */
export function premigratePattern(source: string): RegExp {
  return new RegExp(`^${source}-premigrate-v\\d+-\\d.*\\.db(\\.enc)?$`);
}

/** How many pre-migration snapshots to retain. Each is a full copy of the DB. */
export const PREMIGRATE_KEEP = Number(process.env.PREMIGRATE_KEEP) || 2;
