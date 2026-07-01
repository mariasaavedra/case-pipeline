// =============================================================================
// Backup encryption — AES-256-GCM at rest
// =============================================================================
// Database backups (live.db, users.db) contain client PII and Monday.com OAuth
// tokens. On-disk backups are encrypted so a leaked backup file is useless
// without the key. The key is a passphrase from BACKUP_ENCRYPTION_KEY (env),
// never stored alongside the backups.
//
// File format:  [MAGIC "CPB1" (4)] [salt (16)] [iv (12)] [ciphertext…] [tag (16)]
// The 32-byte AES key is derived per-file from the passphrase + random salt via
// scrypt, so the same passphrase never reuses a key. Restore with
// scripts/restore-backup.ts.
// =============================================================================

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  readFileSync,
  writeFileSync,
  unlinkSync,
  statSync,
  openSync,
  readSync,
  closeSync,
} from "node:fs";
import { pipeline } from "node:stream/promises";

const MAGIC = Buffer.from("CPB1", "ascii"); // 4 bytes
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + SALT_LEN + IV_LEN; // 32
const KEY_LEN = 32;

/** The backup passphrase from env, or null when encryption is disabled. */
export function backupEncryptionKey(): string | null {
  const key = process.env.BACKUP_ENCRYPTION_KEY?.trim();
  return key ? key : null;
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_LEN);
}

/**
 * Encrypt `src` in-place to `src + ".enc"` (streaming, constant memory) and
 * delete the plaintext. Returns the path of the encrypted file. Use for large
 * files (live.db can be hundreds of MB).
 */
export async function encryptFile(src: string, passphrase: string): Promise<string> {
  const dest = `${src}.enc`;
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);

  const out = createWriteStream(dest);
  out.write(Buffer.concat([MAGIC, salt, iv]));

  // Pipe plaintext through the cipher into `out`, but keep `out` open so the
  // 16-byte auth tag can be appended after the cipher flushes.
  await new Promise<void>((resolve, reject) => {
    const source = createReadStream(src);
    source.on("error", reject);
    cipher.on("error", reject);
    out.on("error", reject);
    cipher.on("data", (chunk) => out.write(chunk));
    cipher.on("end", () => {
      out.end(cipher.getAuthTag(), () => resolve());
    });
    source.pipe(cipher);
  });

  unlinkSync(src);
  return dest;
}

/**
 * Synchronous variant for small files (e.g. users.db, a few KB) where loading
 * the whole file into memory is fine and the caller runs in a sync context.
 */
export function encryptFileSync(src: string, passphrase: string): string {
  const dest = `${src}.enc`;
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  const plaintext = readFileSync(src);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  writeFileSync(dest, Buffer.concat([MAGIC, salt, iv, body, tag]));
  unlinkSync(src);
  return dest;
}

/**
 * Decrypt a `.enc` backup produced by either encrypt function to `outPath`.
 * Streaming, so it restores a large live.db without loading it into memory.
 */
export async function decryptFile(encPath: string, passphrase: string, outPath: string): Promise<void> {
  const size = statSync(encPath).size;
  if (size < HEADER_LEN + TAG_LEN) {
    throw new Error(`Not a valid encrypted backup (too small): ${encPath}`);
  }

  // Read the fixed header and the trailing auth tag.
  const header = Buffer.alloc(HEADER_LEN);
  const tag = Buffer.alloc(TAG_LEN);
  const fd = openSync(encPath, "r");
  try {
    readSync(fd, header, 0, HEADER_LEN, 0);
    readSync(fd, tag, 0, TAG_LEN, size - TAG_LEN);
  } finally {
    closeSync(fd);
  }

  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error(`Not a case-pipeline encrypted backup (bad magic): ${encPath}`);
  }
  const salt = header.subarray(MAGIC.length, MAGIC.length + SALT_LEN);
  const iv = header.subarray(MAGIC.length + SALT_LEN, HEADER_LEN);

  const decipher = createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  decipher.setAuthTag(tag);

  // Stream only the ciphertext bytes (between header and trailing tag).
  await pipeline(
    createReadStream(encPath, { start: HEADER_LEN, end: size - TAG_LEN - 1 }),
    decipher,
    createWriteStream(outPath),
  );
}
