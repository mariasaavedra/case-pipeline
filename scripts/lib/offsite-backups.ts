// =============================================================================
// Off-site backups — which files go, and which remote copies age out
// =============================================================================
// Pure rules for scripts/backup-offsite.ts, kept apart so they are unit-tested
// without SharePoint. The daily backup writes `live-<ISO stamp>.db.enc` and
// `users-<ISO stamp>.db.enc` into data/backups/ (server.ts runBackup); until
// these copies left the droplet, losing its disk lost every backup with it.
// =============================================================================

/** The two daily series. A digit after the dash = the ISO year, which keeps
 * "live-premigrate-…" and "live-presync-…" safety snapshots out. */
export const SERIES = ["live", "users"] as const;
export type Series = (typeof SERIES)[number];

const seriesRe = (series: string) => new RegExp(`^${series}-\\d[^/]*\\.db\\.enc$`);

/** The series a backup file name belongs to, or null for anything else. */
export function seriesOf(name: string): Series | null {
  return SERIES.find((s) => seriesRe(s).test(name)) ?? null;
}

/**
 * Only encrypted backups ever leave the server. A plain `.db` is a full copy of
 * client data; uploading one would put it in SharePoint readable by anyone
 * with access to the folder.
 */
export function refuseReason(name: string): string | null {
  if (!name.endsWith(".db.enc")) return `${name} is not an encrypted backup (.db.enc) — refusing to upload it`;
  if (!seriesOf(name)) return `${name} is not a daily live/users backup`;
  return null;
}

/** The newest file of each series in a directory listing (names sort by their ISO stamp). */
export function newestPerSeries(names: string[]): Partial<Record<Series, string>> {
  const out: Partial<Record<Series, string>> = {};
  for (const name of [...names].sort()) {
    const s = seriesOf(name);
    if (s) out[s] = name;
  }
  return out;
}

/** Remote copies to delete so each series keeps its newest `keep`. Other names are never touched. */
export function remoteToPrune(names: string[], keep: number): string[] {
  const out: string[] = [];
  for (const s of SERIES) {
    const mine = names.filter((n) => seriesOf(n) === s).sort();
    out.push(...mine.slice(0, Math.max(0, mine.length - Math.max(1, keep))));
  }
  return out;
}

/** Upload-session chunks must be multiples of 320 KiB; 32 × 320 KiB = 10 MiB. */
export const UPLOAD_CHUNK = 320 * 1024 * 32;

/** [start, end) byte ranges covering `size`, one per upload-session PUT. */
export function chunkRanges(size: number, chunk = UPLOAD_CHUNK): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let start = 0; start < size; start += chunk) out.push([start, Math.min(start + chunk, size)]);
  return out;
}
