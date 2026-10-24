// =============================================================================
// Client upload links — the rules (no I/O)
// =============================================================================
// A client gets a private link (/u/<token>) to send us documents. Upload-only:
// the page shows their first name and nothing else, so a forwarded link lets
// someone send us files, never see any. docs/features/client-uploads.md.
//
// What a file must be is decided here from its first bytes, never from the
// name or the browser's type: a renamed .exe is refused as what it is.
// =============================================================================

import { createHash, randomBytes } from "node:crypto";

/** Off unless CLIENT_UPLOADS=on and API_URL (the public host the link is on). */
export function clientUploadsConfig(env: NodeJS.ProcessEnv = process.env): { publicUrl: string } | null {
  if (env.CLIENT_UPLOADS?.trim().toLowerCase() !== "on") return null;
  const publicUrl = env.API_URL?.trim().replace(/\/+$/, "");
  return publicUrl ? { publicUrl } : null;
}

export const LANGUAGES = ["es", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

/** What the client says a file is. The label is the SharePoint name's prefix. */
export const KINDS = {
  id: "ID",
  notice: "Notice",
  evidence: "Evidence",
  other: "Document",
} as const;
export type Kind = keyof typeof KINDS;

export const DEFAULT_LINK_DAYS = 30;
export const MAX_LINK_DAYS = 90;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_FILES_PER_LINK = 200;
export const MAX_BYTES_PER_LINK = 1024 * 1024 * 1024;
export const MAX_NOTE_CHARS = 500;

// --- Tokens ------------------------------------------------------------------

/** 32 random bytes, base64url: 43 characters. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only the hash is stored, so a copy of the database opens no links. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function linkDays(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return DEFAULT_LINK_DAYS;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= MAX_LINK_DAYS ? n : null;
}

/** UTC in SQLite's datetime('now') format, so it compares as text. */
export function sqliteUtc(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

// --- File types --------------------------------------------------------------

export interface FileType {
  ext: string;
  contentType: string;
}

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

/**
 * PDF, JPEG, PNG, HEIC/HEIF (iPhone photos), TIFF (scanners), and Word. A
 * .docx is a zip and a .doc an OLE file, which their first bytes can't tell
 * from other zips / Office files, so those two also need the matching name.
 */
export function sniffFileType(bytes: Buffer, fileName: string): FileType | null {
  const head = (n: number) => bytes.subarray(0, n);
  const ext = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  if (head(5).toString("latin1") === "%PDF-") return { ext: "pdf", contentType: "application/pdf" };
  if (head(3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return { ext: "jpg", contentType: "image/jpeg" };
  if (head(8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", contentType: "image/png" };
  if (head(4).equals(Buffer.from("II*\0", "latin1")) || head(4).equals(Buffer.from("MM\0*", "latin1"))) {
    return { ext: "tif", contentType: "image/tiff" };
  }
  if (bytes.subarray(4, 8).toString("latin1") === "ftyp" && HEIF_BRANDS.has(bytes.subarray(8, 12).toString("latin1"))) {
    const heic = bytes.subarray(8, 12).toString("latin1").startsWith("he");
    return heic ? { ext: "heic", contentType: "image/heic" } : { ext: "heif", contentType: "image/heif" };
  }
  if (head(4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) && ext === "docx") {
    return { ext: "docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  }
  if (head(8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) && ext === "doc") {
    return { ext: "doc", contentType: "application/msword" };
  }
  return null;
}

// --- Names -------------------------------------------------------------------

/** Characters SharePoint refuses, plus the ones that break links. Same set as the e-sign file names. */
export function cleanName(s: string): string {
  return s.replace(/[\\/:*?"<>|#%&{}$!'@+`=\p{Cc}]+/gu, " ").replace(/\s+/g, " ").trim();
}

/**
 * The name in SharePoint: `2026-10-21 Notice - IMG_4412.jpg`. The extension is
 * the one the bytes say, so a photo named "scan.pdf" lands as .jpg.
 */
export function storedName(receivedOn: string, kind: Kind, originalName: string, type: FileType, label?: string): string {
  const base = cleanName(originalName.replace(/\.[A-Za-z0-9]{1,5}$/, "")).slice(0, 100) || "file";
  // A checklist document names the file after itself: "2026-10-23 Marriage certificate - IMG_1.jpg".
  const prefix = (label && cleanName(label).slice(0, 80)) || KINDS[kind];
  return `${receivedOn} ${prefix} - ${base}.${type.ext}`;
}

/** "Yaucdy Yoselyn QUINTANILLA CASTRO" → "Yaucdy"; "JACOBUS VAN HEERDEN" → "Jacobus". */
export function firstNameOf(profileName: string): string | null {
  const word = profileName
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/^\s*(mr|mrs|ms|miss|dr|sr|sra|srta)\.?\s+/i, "")
    .trim()
    .split(/\s+/)[0];
  if (!word || !/\p{L}/u.test(word)) return null;
  return word.charAt(0).toLocaleUpperCase("es") + word.slice(1).toLocaleLowerCase("es");
}

// --- Rate limit --------------------------------------------------------------

/**
 * Sliding window per key, in memory. One process serves the API, so this is
 * enough; it resets on a restart, which is fine for a flood guard.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly max: number, private readonly windowMs: number) {}

  /** True when this hit is allowed (and counts it). */
  allow(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(now);
    return true;
  }

  private prune(now: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
    }
  }
}
