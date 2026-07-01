// =============================================================================
// restore-backup.ts — decrypt an encrypted database backup
// =============================================================================
// Backups are encrypted at rest (AES-256-GCM) with BACKUP_ENCRYPTION_KEY.
// This restores a `.db.enc` file back to a usable `.db`.
//
// Usage:
//   BACKUP_ENCRYPTION_KEY=... npx tsx scripts/restore-backup.ts <input.db.enc> [output.db]
//
// If output is omitted, it drops the `.enc` suffix. Never overwrites an
// existing output file.
// =============================================================================

import { existsSync } from "node:fs";
import { decryptFile, backupEncryptionKey } from "../apps/api/src/backup/crypto.js";

async function main(): Promise<void> {
  const [input, outputArg] = process.argv.slice(2);

  if (!input) {
    console.error("Usage: BACKUP_ENCRYPTION_KEY=... npx tsx scripts/restore-backup.ts <input.db.enc> [output.db]");
    process.exit(1);
  }
  if (!existsSync(input)) {
    console.error(`Input file not found: ${input}`);
    process.exit(1);
  }

  const key = backupEncryptionKey();
  if (!key) {
    console.error("BACKUP_ENCRYPTION_KEY is not set — cannot decrypt.");
    process.exit(1);
  }

  const output = outputArg ?? input.replace(/\.enc$/, "");
  if (output === input) {
    console.error("Refusing to write over the encrypted input; specify an output path.");
    process.exit(1);
  }
  if (existsSync(output)) {
    console.error(`Output already exists (refusing to overwrite): ${output}`);
    process.exit(1);
  }

  try {
    await decryptFile(input, key, output);
    console.log(`✓ Decrypted → ${output}`);
  } catch (err) {
    console.error(`✗ Decryption failed: ${err instanceof Error ? err.message : String(err)}`);
    console.error("  (wrong BACKUP_ENCRYPTION_KEY, or the file is corrupt/tampered)");
    process.exit(1);
  }
}

void main();
