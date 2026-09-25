// =============================================================================
// Backup verification
// =============================================================================
// Retention asks one question: "do I have a known-good copy to keep?" This
// answers it about the copy, which is the thing it is actually about.
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { openDatabase, checkIntegrity } from "@case-pipeline/seed/db/connection";

/**
 * Whether the backup we just wrote is itself sound.
 *
 * Retention used to gate on the integrity of the LIVE database, sampled just
 * before the copy. That was the wrong question asked at the worst moment: a
 * 1.5 GB `quick_check` on the busiest file in the system, while webhook syncs
 * fire every few minutes and the WAL is at its largest after the nightly walk.
 * It returned "corrupt" every night for a fortnight — with no exception thrown,
 * so it was not a lock either — while the same check run by hand on the same
 * file answered "ok". Retention stopped, and 11 copies of a 1.5 GB database
 * filled the disk that a full disk had already corrupted once, in July 2026.
 *
 * The question retention actually needs answered is "do I have a known-good
 * copy to keep?", and the copy is the thing to ask. Nothing else holds it open,
 * so the answer is reliable — and it is strictly safer: the old logic would
 * happily prune when the source was fine but the copy had been written badly,
 * which is the case that actually loses data.
 *
 * Must run BEFORE encryptFile: afterwards the file is ciphertext and cannot be
 * opened as a database at all.
 */
export function verifyWrittenBackup(file: string): boolean {
  let handle: ReturnType<typeof openDatabase> | null = null;
  try {
    // A zero-length file is a VALID EMPTY DATABASE to SQLite: quick_check says
    // "ok" and reports no damage. A backup that wrote nothing would therefore
    // verify, and authorise deleting every good copy behind it. Size alone is
    // not enough either — what makes it a backup is that it has the schema.
    const bytes = fs.statSync(file).size;
    handle = openDatabase(file, { readonly: true });
    const tables = (
      handle.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }
    ).n;
    if (bytes === 0 || tables === 0) {
      console.error(
        `[backup] the copy just written is empty (${bytes} bytes, ${tables} tables): ` +
          `${path.basename(file)} — keeping older backups.`,
      );
      return false;
    }

    const verdict = checkIntegrity(handle);
    if (verdict !== "ok") {
      console.error(`[backup] the copy just written is ${verdict}: ${path.basename(file)} — keeping older backups.`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[backup] could not verify ${path.basename(file)} — keeping older backups:`, err);
    return false;
  } finally {
    try {
      handle?.close();
    } catch {
      // Nothing to do; the file is read-only and about to be encrypted.
    }
  }
}
