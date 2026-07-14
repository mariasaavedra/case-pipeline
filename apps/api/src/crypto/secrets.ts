// =============================================================================
// App secret encryption — AES-256-GCM at rest (column level)
// =============================================================================
// Per-user secrets stored in users.db (today: Monday.com OAuth tokens, later
// any other credential) are encrypted before they touch the column, so a leaked
// DB file — or a stray backup — is useless without the key.
//
// This is the string-level companion to backup/crypto.ts (which encrypts whole
// DB files). Same primitives (AES-256-GCM + scrypt, random per-value salt/iv),
// but the output is a single self-contained base64 string that fits in a TEXT
// column:
//
//   "CPS1:" + base64( salt(16) | iv(12) | tag(16) | ciphertext )
//
// The key is a passphrase from APP_ENCRYPTION_KEY — deliberately separate from
// BACKUP_ENCRYPTION_KEY, so rotating or compromising one never affects the
// other. Generate one with:  openssl rand -base64 48
// =============================================================================

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const PREFIX = "CPS1:"; // marks a value as encrypted (and versions the format)
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

/** The app secret passphrase from env, or null when encryption is disabled. */
export function appEncryptionKey(): string | null {
  const key = process.env.APP_ENCRYPTION_KEY?.trim();
  return key ? key : null;
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_LEN);
}

/** True if `value` is a string produced by encryptString (vs legacy plaintext). */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

/**
 * Encrypt a short string. Throws if APP_ENCRYPTION_KEY is not set — callers that
 * want graceful degradation should use `protect` instead.
 */
export function encryptString(plain: string): string {
  const passphrase = appEncryptionKey();
  if (!passphrase) {
    throw new Error("APP_ENCRYPTION_KEY is not set; cannot encrypt secret.");
  }
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([salt, iv, tag, body]).toString("base64");
}

/**
 * Decrypt a value produced by encryptString. A value without the CPS1 prefix is
 * assumed to be legacy plaintext and returned unchanged (so reads keep working
 * during/after the one-time re-encryption migration).
 */
export function decryptString(value: string): string {
  if (!isEncrypted(value)) return value; // legacy plaintext passthrough
  const passphrase = appEncryptionKey();
  if (!passphrase) {
    throw new Error("APP_ENCRYPTION_KEY is not set; cannot decrypt secret.");
  }
  const raw = Buffer.from(value.slice(PREFIX.length), "base64");
  const salt = raw.subarray(0, SALT_LEN);
  const iv = raw.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const tag = raw.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const body = raw.subarray(SALT_LEN + IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

let warnedNoKey = false;

/**
 * Encrypt if a key is configured; otherwise store plaintext and warn once.
 * Keeps the app working in dev/first-boot before APP_ENCRYPTION_KEY is set,
 * without silently pretending secrets are protected.
 */
export function protect(plain: string): string {
  if (!appEncryptionKey()) {
    if (!warnedNoKey) {
      console.warn(
        "[secrets] APP_ENCRYPTION_KEY not set — storing secrets in plaintext. " +
          "Set it (openssl rand -base64 48) to encrypt tokens at rest.",
      );
      warnedNoKey = true;
    }
    return plain;
  }
  return encryptString(plain);
}

/** Reveal a stored secret (handles both encrypted and legacy-plaintext values). */
export function reveal(value: string): string {
  return decryptString(value);
}
