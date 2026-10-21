// =============================================================================
// Client upload links — routes (docs/features/client-uploads.md)
// =============================================================================
// Staff (behind requireAuth, audited upload_link.*):
//   POST   /api/profiles/:localId/upload-links  {language, days?} → {url, expiresAt, replaced}
//            One active link per client: a new one revokes the current one.
//            The only response that ever carries the token.
//   GET    /api/profiles/:localId/upload-links  links (newest first) + what came in on each
//   PATCH  /api/upload-links/:id  {days}        extend: expires `days` from now
//   DELETE /api/upload-links/:id                revoke
//
// Public (no login — the token is the key; registered BEFORE the /api/
// requireAuth catch-all):
//   GET  /api/u/:token        {firstName, language} for the client page
//   POST /api/u/:token/files  raw body, ?name=&kind=&note=, one file per request
//
// Unknown, expired and revoked links all get the same 404, so nobody can tell
// a dead link from a made-up one. Files are kept under data/uploads/ and the
// filing job (uploads/job.ts) moves them into the client's E-File → CAF.
// =============================================================================

import express from "express";
import type { Express, NextFunction, Request, Response } from "express";
import type BetterSqlite3 from "better-sqlite3";
type DatabaseInstance = BetterSqlite3.Database;
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { requireAuth } from "../auth/middleware.js";
import { auditFromReq, recordAudit } from "../audit/log.js";
import { DATA_DIR } from "../paths.js";
import { FIRM_TIMEZONE } from "../firm.js";
import {
  KINDS, LANGUAGES, MAX_BYTES_PER_LINK, MAX_FILES_PER_LINK, MAX_FILE_BYTES, MAX_NOTE_CHARS, RateLimiter, TOKEN_RE,
  clientUploadsConfig, firstNameOf, hashToken, linkDays, newToken, sniffFileType, sqliteUtc, storedName,
  type Kind, type Language,
} from "../uploads/rules.js";
import { fileSoon } from "../uploads/job.js";

export const UPLOADS_DIR = "uploads";

/** Per link: plenty for a client sending a stack of photos, not for a script. */
const perLink = new RateLimiter(60, 10 * 60_000);
/** All links together. No `trust proxy` here, so per-IP would be per-proxy. */
const overall = new RateLimiter(600, 10 * 60_000);

interface LinkRow {
  id: number;
  profile_local_id: string;
  profile_monday_id: string | null;
  language: Language;
  created_by_name: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_by_name: string | null;
  last_used_at: string | null;
}

interface ProfileRow {
  localId: string;
  mondayId: string | null;
  name: string;
}

function profileOf(db: DatabaseInstance, localId: string): ProfileRow | undefined {
  return db.prepare(
    "SELECT local_id AS localId, monday_item_id AS mondayId, name FROM profiles WHERE local_id = ? AND deleted_at IS NULL",
  ).get(localId) as ProfileRow | undefined;
}

/** A client's links by their Monday id when they have one (survives a re-sync), else the local id. */
function profileClause(p: { localId: string; mondayId: string | null }): { sql: string; args: string[] } {
  return p.mondayId
    ? { sql: "(profile_monday_id = ? OR profile_local_id = ?)", args: [p.mondayId, p.localId] }
    : { sql: "profile_local_id = ?", args: [p.localId] };
}

function activeLinkByToken(db: DatabaseInstance, token: string): LinkRow | undefined {
  if (!TOKEN_RE.test(token)) return undefined;
  return db.prepare(
    "SELECT * FROM upload_links WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > datetime('now')",
  ).get(hashToken(token)) as LinkRow | undefined;
}

/** The link's client now: by Monday id first, so a re-sync's new local id still finds them. */
function linkProfileName(db: DatabaseInstance, link: LinkRow): string | null {
  const row = (link.profile_monday_id
    ? db.prepare("SELECT name FROM profiles WHERE monday_item_id = ? AND deleted_at IS NULL").get(link.profile_monday_id)
    : undefined) ?? db.prepare("SELECT name FROM profiles WHERE local_id = ? AND deleted_at IS NULL").get(link.profile_local_id);
  return (row as { name: string } | undefined)?.name ?? null;
}

function firmToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: FIRM_TIMEZONE });
}

const notFound = (res: Response) => res.status(404).json({ error: "This link is not valid any more. Ask the office for a new one." });

/** Public routes. Register BEFORE the /api/ requireAuth catch-all. */
export function registerClientUploadPublicRoutes(app: Express, deps: { db: DatabaseInstance }): void {
  const { db } = deps;
  const uploadDir = path.join(DATA_DIR, UPLOADS_DIR);
  const rawFile = express.raw({ type: () => true, limit: MAX_FILE_BYTES });

  app.get("/api/u/:token", (req, res) => {
    if (!clientUploadsConfig()) return notFound(res);
    const link = activeLinkByToken(db, String(req.params.token));
    if (!link) return notFound(res);
    const name = linkProfileName(db, link);
    res.json({ data: { firstName: name ? firstNameOf(name) : null, language: link.language } });
  });

  app.post(
    "/api/u/:token/files",
    // Checked before the body is read: a dead link or a flood never gets to send 50 MB.
    (req: Request, res: Response, next: NextFunction) => {
      if (!clientUploadsConfig()) return notFound(res);
      const token = String(req.params.token);
      const link = activeLinkByToken(db, token);
      if (!link) return notFound(res);
      if (!overall.allow("all") || !perLink.allow(String(link.id))) {
        res.status(429).json({ error: "Too many files at once. Wait a few minutes and try again." });
        return;
      }
      res.locals.link = link;
      rawFile(req, res, (err?: unknown) => {
        if (!err) return next();
        const status = (err as { status?: number }).status;
        if (status === 413) res.status(413).json({ error: `Each file can be up to ${MAX_FILE_BYTES / 1024 / 1024} MB.` });
        else res.status(400).json({ error: "The file did not arrive. Try again." });
      });
    },
    (req: Request, res: Response) => {
      const link = res.locals.link as LinkRow;
      const body = req.body as unknown;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ error: "The file is empty." });
        return;
      }
      const originalName = String(req.query.name ?? "").trim().slice(0, 200) || "file";
      const kindRaw = String(req.query.kind ?? "other");
      if (!(kindRaw in KINDS)) {
        res.status(400).json({ error: "Unknown document kind" });
        return;
      }
      const kind = kindRaw as Kind;
      const note = String(req.query.note ?? "").trim().slice(0, MAX_NOTE_CHARS) || null;
      const type = sniffFileType(body, originalName);
      if (!type) {
        res.status(415).json({ error: "Send a PDF, a photo (JPG, PNG, HEIC), a TIFF scan or a Word document.", code: "type" });
        return;
      }

      const totals = db.prepare(
        "SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM client_uploads WHERE link_id = ?",
      ).get(link.id) as { n: number; bytes: number };
      if (totals.n >= MAX_FILES_PER_LINK || totals.bytes + body.length > MAX_BYTES_PER_LINK) {
        res.status(413).json({ error: "This link has received all the files it can. Ask the office for a new one.", code: "link_full" });
        return;
      }

      const sha256 = createHash("sha256").update(body).digest("hex");
      const same = db.prepare("SELECT id FROM client_uploads WHERE link_id = ? AND sha256 = ?").get(link.id, sha256);
      if (same) {
        res.json({ data: { received: true, duplicate: true } });
        return;
      }

      fs.mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
      const localFile = `${randomBytes(16).toString("hex")}.${type.ext}`;
      const fullPath = path.join(uploadDir, localFile);
      fs.writeFileSync(fullPath, body, { mode: 0o600 });
      let id: number;
      try {
        id = Number(db.prepare(`
          INSERT INTO client_uploads (link_id, original_name, stored_name, local_file, size, content_type, sha256, kind, note)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(link.id, originalName, storedName(firmToday(), kind, originalName, type), localFile, body.length, type.contentType, sha256, kind, note).lastInsertRowid);
      } catch (err) {
        fs.rmSync(fullPath, { force: true });
        // The same file twice at once: the other request kept it.
        if (String((err as Error).message).includes("UNIQUE")) {
          res.json({ data: { received: true, duplicate: true } });
          return;
        }
        throw err;
      }
      db.prepare("UPDATE upload_links SET last_used_at = datetime('now') WHERE id = ?").run(link.id);
      // No file name in the audit: clients name files after themselves.
      recordAudit({
        actor: { userId: null, email: "client-upload-link" },
        action: "client_upload.received",
        targetType: "profile", targetId: link.profile_local_id, targetMondayId: link.profile_monday_id,
        metadata: { link: link.id, upload: id, kind, size: body.length, type: type.ext },
      });
      fileSoon();
      res.json({ data: { received: true, duplicate: false } });
    },
  );
}

export function registerClientUploadRoutes(app: Express, deps: { db: DatabaseInstance }): void {
  const { db } = deps;

  app.post("/api/profiles/:localId/upload-links", requireAuth, (req, res) => {
    const config = clientUploadsConfig();
    if (!config) {
      res.status(503).json({ error: "Client upload links are not turned on on this server" });
      return;
    }
    const profile = profileOf(db, String(req.params.localId));
    if (!profile) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const body = (req.body ?? {}) as { language?: unknown; days?: unknown };
    const language = String(body.language ?? "es") as Language;
    if (!LANGUAGES.includes(language)) {
      res.status(400).json({ error: "language must be es or en" });
      return;
    }
    const days = linkDays(body.days);
    if (days === null) {
      res.status(400).json({ error: "days must be a whole number from 1 to 90" });
      return;
    }
    const by = req.user?.name ? String(req.user.name) : null;
    const token = newToken();
    const expiresAt = sqliteUtc(new Date(Date.now() + days * 86_400_000));
    const who = profileClause(profile);

    const { id, replaced } = db.transaction(() => {
      const revoked = db.prepare(
        `UPDATE upload_links SET revoked_at = datetime('now'), revoked_by_name = ?
          WHERE ${who.sql} AND revoked_at IS NULL AND expires_at > datetime('now')`,
      ).run(by, ...who.args).changes;
      const inserted = db.prepare(`
        INSERT INTO upload_links (profile_local_id, profile_monday_id, token_hash, language, created_by_oid, created_by_name, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(profile.localId, profile.mondayId, hashToken(token), language, req.user?.oid ?? null, by, expiresAt);
      return { id: Number(inserted.lastInsertRowid), replaced: revoked > 0 };
    })();

    auditFromReq(req, "upload_link.created", {
      targetType: "profile", targetId: profile.localId, targetMondayId: profile.mondayId,
      metadata: { link: id, days, language, replaced },
    });
    res.status(201).json({ data: { id, url: `${config.publicUrl}/u/${token}`, expiresAt, replaced } });
  });

  app.get("/api/profiles/:localId/upload-links", requireAuth, (req, res) => {
    const profile = profileOf(db, String(req.params.localId));
    if (!profile) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const who = profileClause(profile);
    const links = db.prepare(
      `SELECT *, (revoked_at IS NULL AND expires_at > datetime('now')) AS active
         FROM upload_links WHERE ${who.sql} ORDER BY id DESC`,
    ).all(...who.args) as (LinkRow & { active: number })[];
    const uploads = links.length
      ? db.prepare(`
          SELECT id, link_id, received_at, stored_name, size, content_type, kind, note, sharepoint_url, filed_where, filed_at, last_error
            FROM client_uploads WHERE link_id IN (${links.map(() => "?").join(",")}) ORDER BY id DESC
        `).all(...links.map((l) => l.id)) as { link_id: number }[]
      : [];
    res.json({
      data: {
        enabled: !!clientUploadsConfig(),
        links: links.map((l) => ({
          id: l.id, language: l.language, active: l.active === 1,
          createdAt: l.created_at, createdBy: l.created_by_name, expiresAt: l.expires_at,
          revokedAt: l.revoked_at, revokedBy: l.revoked_by_name, lastUsedAt: l.last_used_at,
          uploads: uploads.filter((u) => u.link_id === l.id).map(({ link_id: _, ...u }) => u),
        })),
      },
    });
  });

  function linkById(id: string): LinkRow | undefined {
    return /^\d+$/.test(id) ? (db.prepare("SELECT * FROM upload_links WHERE id = ?").get(Number(id)) as LinkRow | undefined) : undefined;
  }

  app.patch("/api/upload-links/:id", requireAuth, (req, res) => {
    const link = linkById(String(req.params.id));
    if (!link) {
      res.status(404).json({ error: "Link not found" });
      return;
    }
    if (link.revoked_at) {
      res.status(409).json({ error: "This link was turned off. Create a new one." });
      return;
    }
    const days = linkDays((req.body ?? {}).days);
    if (days === null) {
      res.status(400).json({ error: "days must be a whole number from 1 to 90" });
      return;
    }
    // An expired link can be brought back, unless the client has a newer one.
    const newer = db.prepare(
      "SELECT 1 FROM upload_links WHERE id > ? AND (profile_local_id = ? OR (profile_monday_id IS NOT NULL AND profile_monday_id = ?)) AND revoked_at IS NULL",
    ).get(link.id, link.profile_local_id, link.profile_monday_id);
    if (newer) {
      res.status(409).json({ error: "This client has a newer link" });
      return;
    }
    const expiresAt = sqliteUtc(new Date(Date.now() + days * 86_400_000));
    db.prepare("UPDATE upload_links SET expires_at = ? WHERE id = ?").run(expiresAt, link.id);
    auditFromReq(req, "upload_link.extended", {
      targetType: "profile", targetId: link.profile_local_id, targetMondayId: link.profile_monday_id,
      metadata: { link: link.id, days },
    });
    res.json({ data: { id: link.id, expiresAt } });
  });

  app.delete("/api/upload-links/:id", requireAuth, (req, res) => {
    const link = linkById(String(req.params.id));
    if (!link) {
      res.status(404).json({ error: "Link not found" });
      return;
    }
    if (!link.revoked_at) {
      db.prepare("UPDATE upload_links SET revoked_at = datetime('now'), revoked_by_name = ? WHERE id = ?")
        .run(req.user?.name ? String(req.user.name) : null, link.id);
      auditFromReq(req, "upload_link.revoked", {
        targetType: "profile", targetId: link.profile_local_id, targetMondayId: link.profile_monday_id,
        metadata: { link: link.id },
      });
    }
    res.json({ data: { id: link.id, revoked: true } });
  });
}
