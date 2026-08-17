// =============================================================================
// Disk headroom
// =============================================================================
// A full disk is this system's most expensive failure mode: it caused the
// 2026-07 database corruptions (a sync ran out of room mid-write) and, on
// 2026-08-17, a week of silently failed backups. Both times the condition was
// measurable long before anything broke, and nothing was measuring it.
//
// Thresholds match scripts/health.ts so the CLI and the HTTP endpoint can never
// disagree about what "low" means. A full sync needs roughly 1 GB of headroom
// for its pre-sync snapshot and WAL.
// =============================================================================

import fs from "node:fs";

export type DiskLevel = "ok" | "low" | "critical" | "unknown";

/** Free space thresholds, in GB. */
export const DISK_CRITICAL_GB = 1;
export const DISK_LOW_GB = 3;

export interface DiskReading {
  level: DiskLevel;
  freeGb: number | null;
  usedPct: number | null;
}

/** Measure free space on the filesystem holding `dir`. Never throws. */
export function readDisk(dir: string): DiskReading {
  try {
    const s = fs.statfsSync(dir);
    const freeBytes = s.bavail * s.bsize;
    const totalBytes = s.blocks * s.bsize;
    const freeGb = freeBytes / 1e9;
    const usedPct = totalBytes > 0 ? Math.round((1 - freeBytes / totalBytes) * 100) : null;
    const level: DiskLevel =
      freeGb < DISK_CRITICAL_GB ? "critical" : freeGb < DISK_LOW_GB ? "low" : "ok";
    return { level, freeGb, usedPct };
  } catch {
    // An unreadable filesystem is not a reason to fail a health check, but it
    // must not read as healthy either.
    return { level: "unknown", freeGb: null, usedPct: null };
  }
}

/** Just the level — what /health publishes, since it sits outside auth. */
export function diskLevel(dir: string): DiskLevel {
  return readDisk(dir).level;
}
