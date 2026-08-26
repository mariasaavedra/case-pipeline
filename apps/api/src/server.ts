// =============================================================================
// Case Pipeline — Web Server
// =============================================================================

import type Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import cron from "node-cron";
import { initializeSchema, getSchemaVersion, SCHEMA_VERSION } from "@case-pipeline/seed/db/schema";
import { openDatabase, isDatabaseHealthy } from "@case-pipeline/seed/db/connection";
import { startWriteQueueProcessor, enqueueWrite } from "./write-queue/processor.js";
import { refreshBoardSchema } from "./schema-refresh.js";
import {
  handleListClients,
  handleSearch,
  handleTypedSearch,
  handleFilterOptions,
  handleClientDetail,
  handleClientContracts,
  handleClientBoardItems,
  handleBoardItemDetail,
  handleClientUpdates,
  handleClientRelationships,
  handleAlerts,
  handleCallLog,
} from "./handlers/handlers";
import { getAppointments, getDashboardKpis, getKpiCardDetail, getActiveCases, getBoardStatusOptions, getBoardStatusOptionsFor, getBoardColumns, getBoardColumnsFor, getSyncHealth, getArchivedRows, getCalendarEvents } from "@case-pipeline/query";
import type { Urgency, CalendarCategory } from "@case-pipeline/query";
import { setApiToken, fetchBoardStructure, fetchItem, resolveAllColumns, fetchWorkspaceUsers, fetchItemUpdatesBatch } from "@case-pipeline/monday";
import type { MondayWorkspaceUser, CreateTimelineItemInput, UpdateMention } from "@case-pipeline/monday";
import { dataSource } from "./data-source/index.js";
import { loadConfig } from "@case-pipeline/config";
import { mapItemToTemplateVars, validateTemplateVars, renderDocxTemplate } from "@case-pipeline/template";
import { requireAuth, requireAdmin } from "./auth/middleware.js";
import { handleAuthMe } from "./routes/auth.js";
import {
  handleAdminListUsers,
  handleAdminUpdateRole,
  handleAdminUpdateUser,
  handleAdminAudit,
} from "./routes/admin.js";
import { handleGetPreferences, handleUpdatePreferences } from "./routes/preferences.js";
import {
  handleUpdateMyProfile,
  handleGetRecentlyViewed,
  handleGetWatchlist,
  handleAddWatchlist,
  handleRemoveWatchlist,
  handleGetSavedViews,
  handleAddSavedView,
  handleDeleteSavedView,
  recordRecentlyViewed,
  mondayIdForProfile,
} from "./routes/me.js";
import { handleMyCases } from "./routes/my-cases.js";
import { handleParalegals } from "./routes/paralegals.js";
import {
  initKpiColumns,
  loadGlobalKpiColumns,
  saveGlobalKpiColumns,
  resolveKpiColumns,
} from "./routes/kpi-columns.js";
import {
  initStatusOverrides,
  loadStatusOverrides,
  saveStatusOverrides,
} from "./routes/status-overrides.js";
import {
  initUrgencySettings,
  loadUrgencySettings,
  saveUrgencySettings,
} from "./routes/urgency-settings.js";
import { currentUserId } from "./db/user-context.js";
import { sanitizeKpiColumns } from "./db/users-types.js";
import { auditFromReq } from "./audit/log.js";
import { usersDb } from "./db/users-db.js";
import { backupEncryptionKey, encryptFile } from "./backup/crypto.js";
import { pruneBackupSeries, premigratePattern, PREMIGRATE_KEEP } from "./backup/prune.js";
import { diskLevel, readDisk } from "./backup/disk.js";
import { registerMondayOAuth, getUserMondayToken, markMondayTokenRejected } from "./routes/monday-oauth.js";
import { withTokenFallback, type TokenFallbackOptions } from "./write-auth.js";
import { checkEnvironment, reportEnvironment } from "./config/env-check.js";
import { registerMondayWebhook, webhookSecret } from "./webhooks/receiver.js";
import { startWebhookProcessor, createBoardKeyResolver } from "./webhooks/processor.js";

// =============================================================================
// Database
// =============================================================================

// DB_SOURCE selects which local database the API reads from:
//   seed (default) → data/seed.db (Faker.js data, safe, used by CI)
//   live           → data/live.db (real Monday.com data, gitignored)
// Both share the same schema, query layer, and UI — only the data differs.
const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../data");
// Validate the environment before anything reads it. Every check in env-check.ts
// corresponds to a misconfiguration that once ran silently in production — a
// value wrong in a way that produces no error is worse than one that is absent.
if (
  reportEnvironment(
    checkEnvironment({
      envFilePath: path.resolve(DATA_DIR, "../.env"),
      examplePath: path.resolve(DATA_DIR, "../.env.example"),
    }),
  )
) {
  process.exit(1);
}

const DB_SOURCE = (process.env.DB_SOURCE ?? "seed").toLowerCase();

if (DB_SOURCE !== "seed" && DB_SOURCE !== "live") {
  console.error(`Invalid DB_SOURCE="${process.env.DB_SOURCE}". Expected "seed" or "live".`);
  process.exit(1);
}

const DB_PATH = path.join(DATA_DIR, `${DB_SOURCE}.db`);

if (!fs.existsSync(DB_PATH)) {
  console.error(`Database not found: ${DB_PATH}`);
  console.error(
    DB_SOURCE === "live"
      ? `Run the live sync first (requires MONDAY_API_TOKEN): npm run sync:live`
      : `Generate seed data first: npm run seed`,
  );
  process.exit(1);
}

// durable (synchronous=FULL) for live — it is the only copy of client data.
const db = openDatabase(DB_PATH, { durable: DB_SOURCE === "live" });

// Auto-migrate on startup. A schema mismatch on real client data must never mean
// "re-seed" (that would wipe it) — apply the incremental migrations instead. For
// live data, snapshot first with VACUUM INTO (synchronous, consistent copy) so a
// migration can never be a one-way door.
async function backupBeforeMigrate(fromVersion: number): Promise<void> {
  const backupDir = path.join(DATA_DIR, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(backupDir, `${DB_SOURCE}-premigrate-v${fromVersion}-${stamp}.db`);
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  const key = backupEncryptionKey();
  const final = key ? await encryptFile(dest, key) : dest;
  console.log(`[migrate] Backed up ${DB_SOURCE}.db (v${fromVersion}) → ${final}`);
  // Prune AFTER writing the new one, so a failure here never costs the snapshot
  // this migration just took. Each of these is a full copy of the database —
  // four of them (v16 through v21) were still on disk when it hit 100% on
  // 2026-08-17, because nothing had ever deleted one.
  pruneBackupSeries(backupDir, premigratePattern(DB_SOURCE), PREMIGRATE_KEEP);
}

// Integrity gate — BEFORE anything reads the whole file. On 2026-07-24 a corrupt
// live.db sent the API into a crash loop: the pre-migrate VACUUM INTO tripped on
// the corruption and threw, over and over, spamming 0-byte backup files. Catch it
// here with a clean, single, actionable message instead. quick_check is a fast
// structural scan; it would have flagged that corruption days before it surfaced.
if (!isDatabaseHealthy(db)) {
  console.error("=".repeat(70));
  console.error(`FATAL: ${DB_SOURCE}.db failed its integrity check — the file is corrupt.`);
  console.error("The API will NOT start (a corrupt DB must not be migrated or served).");
  console.error("Restore from a known-good backup, e.g.:");
  console.error("  1. docker compose down");
  console.error("  2. move data/live.db + -wal + -shm aside");
  console.error("  3. decrypt a backup: npx tsx scripts/restore-backup.ts data/backups/<file>.db.enc data/live.db");
  console.error("  4. verify it (quick_check) before swapping it in, then docker compose up -d");
  console.error("=".repeat(70));
  process.exit(1);
}

const currentVersion = getSchemaVersion(db);
if (currentVersion === 0) {
  console.error(`Database at ${DB_PATH} has no schema.`);
  console.error(DB_SOURCE === "live" ? `Run the live sync first: npm run sync:live` : `Generate seed data first: npm run seed`);
  process.exit(1);
}
if (currentVersion < SCHEMA_VERSION) {
  if (DB_SOURCE === "live") await backupBeforeMigrate(currentVersion);
  console.log(`Migrating schema v${currentVersion} → v${SCHEMA_VERSION}…`);
  initializeSchema(db); // applies pending migrations in order (idempotent)
}

// Wire up Monday.com write-back (only needed when MONDAY_API_TOKEN is present)
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN;
if (MONDAY_API_TOKEN) {
  setApiToken(MONDAY_API_TOKEN);
}

/**
 * Token strategy for a write made by an authenticated staff member: their
 * personal Monday token first (for attribution), the shared service token as
 * the net when Monday rejects it on permission grounds — and their connection
 * gets flagged so Settings can ask them to reconnect.
 */
function writeTokenOptions(req: express.Request): TokenFallbackOptions {
  const oid = req.user?.oid ?? "";
  return {
    userToken: oid ? getUserMondayToken(oid) : null,
    sharedToken: MONDAY_API_TOKEN,
    onPersonalTokenRejected: (reason) => markMondayTokenRejected(oid, reason),
  };
}

console.log(`Database loaded (DB_SOURCE=${DB_SOURCE}): ${DB_PATH}`);

// =============================================================================
// Attorney Boards Config
// =============================================================================

export interface AttorneyBoard {
  boardKey: string;
  mondayBoardId: string;
  displayName: string;
  active: boolean;
}

const ATTORNEY_BOARDS_PATH = path.join(DATA_DIR, "attorney-boards.json");

initKpiColumns(DATA_DIR);
initStatusOverrides(DATA_DIR);
initUrgencySettings(DATA_DIR);

/** Build the status → urgency map the Active Cases query consumes. */
function statusUrgencyMap(): Record<string, Urgency> {
  const out: Record<string, Urgency> = {};
  for (const [status, rule] of Object.entries(loadStatusOverrides())) {
    if (rule.urgency) out[status] = rule.urgency;
  }
  return out;
}

function loadAttorneyBoards(): AttorneyBoard[] {
  try {
    return JSON.parse(fs.readFileSync(ATTORNEY_BOARDS_PATH, "utf-8")) as AttorneyBoard[];
  } catch {
    return [];
  }
}

function saveAttorneyBoards(boards: AttorneyBoard[]): void {
  fs.writeFileSync(ATTORNEY_BOARDS_PATH, JSON.stringify(boards, null, 2));
}

function activeBoardKeys(): string[] {
  return loadAttorneyBoards()
    .filter((b) => b.active)
    .map((b) => b.boardKey);
}

// =============================================================================
// Express adapter
// Handlers expect (Request, Database) → Response (Fetch API style).
// We adapt them to Express req/res.
// =============================================================================

type Handler = (req: Request, db: DatabaseInstance) => Response;

function adapt(handler: Handler) {
  return async (req: express.Request, res: express.Response) => {
    const url = `http://localhost${req.originalUrl}`;
    const fetchReq = Object.assign(new Request(url, { method: req.method }), {
      params: req.params,
    });
    const fetchRes = handler(fetchReq, db);
    const body = await fetchRes.text();
    const contentType = fetchRes.headers.get("content-type") ?? "application/json";
    res.status(fetchRes.status).type(contentType).send(body);
  };
}

// =============================================================================
// Server
// =============================================================================

const app = express();
app.use(express.json());

// Auth — unauthenticated entry point (validates token + upserts user)
app.get("/api/auth/me", requireAuth, handleAuthMe);

// Monday.com OAuth (callback is intentionally unauthenticated — browser redirect)
registerMondayOAuth(app);

// Monday.com webhook receiver (intentionally outside requireAuth — Monday can't
// send an Azure AD token; it authenticates via the secret URL path segment).
// Must be registered BEFORE the /api/ requireAuth catch-all below.
registerMondayWebhook(app, db);

// Admin — requireAdmin gates the role once here, so a future admin route can't
// forget the check.
app.get("/api/admin/users", requireAuth, requireAdmin, handleAdminListUsers);
app.patch("/api/admin/users/:id/role", requireAuth, requireAdmin, handleAdminUpdateRole);
app.patch("/api/admin/users/:id", requireAuth, requireAdmin, handleAdminUpdateUser);
app.get("/api/admin/audit", requireAuth, requireAdmin, handleAdminAudit);

// Sync health + the archive of reconciled-away rows (admin-only). Turns "I hope
// it synced" into visible per-board coverage, and makes archived rows restorable.
app.get("/api/admin/sync-health", requireAuth, requireAdmin, (_req, res) => {
  res.json({ data: getSyncHealth(db) });
});
// Discard dead-lettered write-backs (e.g. stale writes that failed before a
// permission/scope fix — retrying them could clobber newer Monday values, so we
// drop rather than replay). The original attempts remain in the audit log.
app.post("/api/admin/write-queue/clear-failed", requireAuth, requireAdmin, (req, res) => {
  const r = db.prepare("DELETE FROM write_queue WHERE status = 'failed'").run();
  auditFromReq(req, "sync.write_queue_cleared", { targetType: "write_queue", targetId: "failed", metadata: { removed: r.changes } });
  res.json({ data: { removed: r.changes } });
});
app.get("/api/admin/archived", requireAuth, requireAdmin, (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit ?? "100"), 10) || 100));
  res.json({ data: getArchivedRows(db, limit) });
});
app.post("/api/admin/archived/:id/restore", requireAuth, requireAdmin, (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  const row = db
    .prepare("SELECT source_table, snapshot_json, monday_item_id FROM archived_rows WHERE id = ?")
    .get(id) as { source_table: string; snapshot_json: string; monday_item_id: string | null } | undefined;
  if (!row) {
    res.status(404).json({ error: "Archived row not found" });
    return;
  }
  const ALLOWED = new Set(["profiles", "contracts", "board_items"]);
  if (!ALLOWED.has(row.source_table)) {
    res.status(400).json({ error: "Unrestorable source table" });
    return;
  }
  try {
    const snap = JSON.parse(row.snapshot_json) as Record<string, unknown>;
    const cols = Object.keys(snap);
    const restore = db.transaction(() => {
      db.prepare(
        `INSERT OR REPLACE INTO ${row.source_table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
      ).run(...cols.map((c) => snap[c] as never));
      db.prepare("DELETE FROM archived_rows WHERE id = ?").run(id);
    });
    restore();
    auditFromReq(req, "sync.row_restored", {
      targetType: row.source_table, targetId: row.monday_item_id ?? String(id),
      targetMondayId: row.monday_item_id,
      metadata: { archivedRowId: id },
    });
    res.json({ data: { restored: true } });
  } catch (err) {
    console.error("[restore] failed:", err);
    res.status(500).json({ error: "Restore failed" });
  }
});

// Protect all remaining /api/* routes
app.use("/api/", requireAuth);

// User preferences & personalization (all require an authenticated caller)
app.get("/api/preferences", handleGetPreferences);
app.put("/api/preferences", handleUpdatePreferences);
app.patch("/api/me/profile", handleUpdateMyProfile);
app.get("/api/me/recently-viewed", (req, res) => handleGetRecentlyViewed(req, res, db));
app.get("/api/watchlist", (req, res) => handleGetWatchlist(req, res, db));
app.post("/api/watchlist", handleAddWatchlist);
app.delete("/api/watchlist/:mondayItemId", handleRemoveWatchlist);
app.get("/api/saved-views", handleGetSavedViews);
app.post("/api/saved-views", handleAddSavedView);
app.delete("/api/saved-views/:id", handleDeleteSavedView);
app.get("/api/my-cases", (req, res) => handleMyCases(req, res, db));
app.get("/api/paralegals", (req, res) => handleParalegals(req, res, db));

// API routes
//
// Dashboard — inline rather than adapt()ed because the per-card display column
// depends on WHO is asking (their preference over the firm-wide default), and
// the Fetch-style handlers don't carry the authenticated user.
app.get("/api/dashboard", (req, res) => {
  const url = new URL(`http://localhost${req.originalUrl}`);
  const range = url.searchParams.get("hearingRange") === "month" ? "month" : "7d";
  const columnSelections = resolveKpiColumns(req);
  res.json({ data: getDashboardKpis(db, { range, columnSelections }) });
});

// Every row behind one card, for the dashboard's click-through modal.
app.get("/api/dashboard/:key/items", (req, res) => {
  const url = new URL(`http://localhost${req.originalUrl}`);
  const range = url.searchParams.get("hearingRange") === "month" ? "month" : "7d";
  // An explicit ?column= previews a different column without saving it, so the
  // picker in the modal can react before the user commits to the choice.
  const columnOverride = url.searchParams.get("column");
  const columnSelections = {
    ...resolveKpiColumns(req),
    ...sanitizeKpiColumns(columnOverride ? { [String(req.params.key)]: columnOverride } : {}),
  };

  const detail = getKpiCardDetail(db, String(req.params.key), { range, columnSelections });
  if (!detail) {
    res.status(404).json({ error: `Unknown dashboard card "${req.params.key}"` });
    return;
  }
  res.json({ data: detail });
});

// Appointments — inline to inject dynamic board keys from attorney-boards.json
app.get("/api/appointments", (req, res) => {
  const url = new URL(`http://localhost${req.originalUrl}`);
  const attorney = url.searchParams.get("attorney") ?? undefined;
  const rangeParam = url.searchParams.get("range");
  const validRanges = ["day", "week", "upcoming", "all"] as const;
  const range = validRanges.includes(rangeParam as (typeof validRanges)[number])
    ? (rangeParam as (typeof validRanges)[number])
    : "day";
  const date = url.searchParams.get("date") ?? undefined;
  const boardKeys = activeBoardKeys();
  const result = getAppointments(db, { attorney, range, date, boardKeys });
  res.json({ data: result });
});

// Active Cases — inline so it can fold in the firm's urgency config (editable
// thresholds + per-status urgency) rather than the query layer's defaults.
app.get("/api/active-cases", (req, res) => {
  const url = new URL(`http://localhost${req.originalUrl}`);
  const includeSnoozed = url.searchParams.get("includeSnoozed") === "1";
  const u = loadUrgencySettings();
  res.json({
    data: getActiveCases(db, {
      includeSnoozed,
      criticalDays: u.criticalDays,
      soonDays: u.soonDays,
      statusUrgency: statusUrgencyMap(),
      statusUrgencyAffectsBoard: u.statusUrgencyAffectsBoard,
    }),
  });
});
// Calendar — hearings, court/USCIS deadlines, interviews, and appointments
// unified across boards. See libs/query/src/calendar.ts.
const VALID_CALENDAR_CATEGORIES = new Set<CalendarCategory>([
  "hearing",
  "court_deadline",
  "uscis_deadline",
  "interview",
  "appointment",
]);
app.get("/api/calendar", (req, res) => {
  const url = new URL(`http://localhost${req.originalUrl}`);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) {
    res.status(400).json({ error: "Query params 'from' and 'to' (YYYY-MM-DD) are required" });
    return;
  }
  const categoriesParam = url.searchParams.get("categories");
  const categories = categoriesParam
    ? (categoriesParam.split(",").filter((c): c is CalendarCategory =>
        VALID_CALENDAR_CATEGORIES.has(c as CalendarCategory),
      ))
    : undefined;
  const attorney = url.searchParams.get("attorney") ?? undefined;
  res.json({ data: getCalendarEvents(db, { from, to, categories, attorney }) });
});

app.get("/api/alerts", adapt(handleAlerts));
app.get("/api/search", adapt(handleTypedSearch));
app.get("/api/filter-options", adapt(handleFilterOptions));
app.get("/api/clients", adapt(handleListClients));
app.get("/api/clients/search", adapt(handleSearch));
app.get(
  "/api/clients/:localId",
  (req, _res, next) => {
    // Record the view for "recently viewed" (best-effort, never blocks the read).
    // Keyed by the stable Monday id — local_id is regenerated by every full sync.
    const uid = currentUserId(req);
    if (uid) {
      const mondayItemId = mondayIdForProfile(db, String(req.params.localId));
      if (mondayItemId) recordRecentlyViewed(uid, mondayItemId);
    }
    next();
  },
  adapt(handleClientDetail),
);
app.get("/api/clients/:localId/contracts", adapt(handleClientContracts));
app.get("/api/clients/:localId/board-items", adapt(handleClientBoardItems));
app.get("/api/clients/:localId/updates", adapt(handleClientUpdates));
app.get("/api/clients/:localId/relationships", adapt(handleClientRelationships));
app.get("/api/board-items/:localId", adapt(handleBoardItemDetail));
app.get("/api/call-log", adapt(handleCallLog));

// =============================================================================
// Profile Write-Back — Post update to Monday.com + persist locally
// =============================================================================

app.post("/api/profiles/:localId/updates", requireAuth, async (req, res) => {
  if (!MONDAY_API_TOKEN) {
    res.status(503).json({ error: "Monday.com write-back not configured (MONDAY_API_TOKEN missing)" });
    return;
  }

  const localId = String(req.params.localId);
  const text = ((req.body as { text?: unknown }).text ?? "").toString().trim();
  if (!text) {
    res.status(400).json({ error: "text is required" });
    return;
  }

  const profile = db
    .prepare("SELECT monday_item_id, batch_id FROM profiles WHERE local_id = ?")
    .get(localId) as { monday_item_id: string | null; batch_id: number } | null;

  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  if (!profile.monday_item_id) {
    res.status(400).json({ error: "Profile has no Monday.com item ID — cannot post update" });
    return;
  }
  const mondayItemId = profile.monday_item_id; // narrowed; the write closure below can't re-narrow a field

  const newLocalId = randomUUID();
  const now = new Date().toISOString();
  const authorName = req.user?.name ?? req.user?.preferred_username ?? "Staff";
  const authorEmail = req.user?.email ?? req.user?.preferred_username ?? null;

  const insertUpdate = (mondayUpdateId: string | null, syncStatus: "synced" | "pending") =>
    db.prepare(`
      INSERT INTO client_updates
        (batch_id, local_id, monday_update_id, profile_local_id, board_item_local_id,
         board_key, author_name, author_email, text_body, body_html, source_type,
         reply_to_update_id, created_at_source, sync_status)
      VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, 'update', NULL, ?, ?)
    `).run(profile.batch_id, newLocalId, mondayUpdateId, localId, authorName, authorEmail, text, now, syncStatus);

  const responseData = (pending: boolean) => ({
    localId: newLocalId,
    profileLocalId: localId,
    boardItemLocalId: null,
    boardKey: null,
    authorName,
    authorEmail,
    textBody: text,
    bodyHtml: null,
    sourceType: "update" as const,
    title: null,
    activityTypeName: null,
    replyToUpdateId: null,
    createdAtSource: now,
    attachments: [],
    pending,
  });

  try {
    // Prefer the posting user's personal Monday.com token; if Monday rejects it
    // on permission grounds the shared token takes over (see write-auth.ts).
    const outcome = await withTokenFallback(
      (token) => dataSource.postUpdate(mondayItemId, text, token),
      writeTokenOptions(req),
    );
    insertUpdate(outcome.result, "synced");
    auditFromReq(req, "monday.update_posted", {
      targetType: "profile",
      targetId: localId,
      targetMondayId: mondayItemId,
      metadata: {
        mondayItemId: profile.monday_item_id,
        mondayUpdateId: outcome.result,
        usedPersonalToken: outcome.usedPersonalToken,
        fellBackToSharedToken: outcome.fellBackToSharedToken,
      },
    });
    res.json({ data: responseData(false) });
  } catch (err) {
    // Resilient fallback: don't lose the note on a transient Monday.com outage.
    // Persist it locally as pending and enqueue the write for background retry.
    console.error("[write-back] createUpdate failed; queueing for retry:", err);
    insertUpdate(null, "pending");
    enqueueWrite(db, {
      opType: "create_update",
      targetTable: "profiles",
      targetLocalId: localId,
      mondayItemId: profile.monday_item_id,
      authorOid: req.user?.oid ?? null,
      payload: { body: text },
    });
    res.status(202).json({ data: responseData(true) });
  }
});

// =============================================================================
// Status write-back — change a board item's status in Monday.com
// =============================================================================
// Any authed staffer can change a status; the write is attributed to their
// personal Monday token when connected. The new value is restricted to the
// board's existing labels (from board_status_options), so we never invent a
// status Monday doesn't have. Same resilient pattern as note write-back: write
// through to Monday, fall back to the durable queue on outage, update live.db
// optimistically (the next sync reconciles authoritatively), and audit.

app.patch("/api/board-items/:localId/status", requireAuth, async (req, res) => {
  if (!MONDAY_API_TOKEN) {
    res.status(503).json({ error: "Monday.com write-back not configured (MONDAY_API_TOKEN missing)" });
    return;
  }

  const localId = String(req.params.localId);
  const status = ((req.body as { status?: unknown }).status ?? "").toString().trim();
  if (!status) {
    res.status(400).json({ error: "status is required" });
    return;
  }

  const item = db
    .prepare("SELECT monday_item_id, board_key, status FROM board_items WHERE local_id = ?")
    .get(localId) as { monday_item_id: string | null; board_key: string; status: string | null } | null;
  if (!item) {
    res.status(404).json({ error: "Board item not found" });
    return;
  }
  if (!item.monday_item_id) {
    res.status(400).json({ error: "Board item has no Monday.com item ID — cannot change status" });
    return;
  }

  // Restrict to a label that exists on this board's status column.
  const def = getBoardStatusOptionsFor(db, item.board_key);
  if (!def) {
    res.status(409).json({ error: "No status options synced for this board yet — run a sync first" });
    return;
  }
  if (!def.options.some((o) => o.label === status)) {
    res.status(400).json({
      error: "Status is not a valid option for this board",
      allowed: def.options.map((o) => o.label),
    });
    return;
  }

  const mondayItemId = item.monday_item_id; // narrowed; the write closure below can't re-narrow a field
  const previous = item.status;
  const applyLocal = () =>
    db.prepare("UPDATE board_items SET status = ? WHERE local_id = ?").run(status, localId);

  try {
    const outcome = await withTokenFallback(
      (token) => dataSource.setColumnValue(def.mondayBoardId, mondayItemId, def.statusColumnId, status, token),
      writeTokenOptions(req),
    );
    applyLocal();
    auditFromReq(req, "monday.status_changed", {
      targetType: "board_item",
      targetId: localId,
      targetMondayId: mondayItemId,
      metadata: {
        mondayItemId: item.monday_item_id, boardKey: item.board_key, columnId: def.statusColumnId,
        from: previous, to: status, usedPersonalToken: outcome.usedPersonalToken,
        fellBackToSharedToken: outcome.fellBackToSharedToken,
      },
    });
    res.json({ data: { localId, status, pending: false } });
  } catch (err) {
    console.error("[write-back] changeSimpleColumnValue failed; queueing for retry:", err);
    applyLocal();
    enqueueWrite(db, {
      opType: "change_column",
      targetTable: "board_items",
      targetLocalId: localId,
      mondayItemId: item.monday_item_id,
      authorOid: req.user?.oid ?? null,
      payload: { boardId: def.mondayBoardId, columnId: def.statusColumnId, value: status },
    });
    auditFromReq(req, "monday.status_changed", {
      targetType: "board_item",
      targetId: localId,
      targetMondayId: mondayItemId,
      metadata: {
        mondayItemId: item.monday_item_id, boardKey: item.board_key, columnId: def.statusColumnId,
        from: previous, to: status, queued: true,
      },
    });
    res.status(202).json({ data: { localId, status, pending: true } });
  }
});

// =============================================================================
// Generic column write-back — change any editable column on a board item
// =============================================================================
// Generalizes the status endpoint to any simple column (status/dropdown/color,
// date, numbers, text). Value goes through change_simple_column_value; choice
// columns are validated against the board's real options. Same resilient rails:
// personal token, queue fallback, audit. Complex/computed columns are rejected.

const SIMPLE_EDITABLE_TYPES = new Set([
  "status", "dropdown", "color", "date", "numbers", "numeric", "text", "long-text", "long_text",
]);
const CHOICE_TYPES = new Set(["status", "dropdown", "color"]);

app.patch("/api/board-items/:localId/columns", requireAuth, async (req, res) => {
  if (!MONDAY_API_TOKEN) {
    res.status(503).json({ error: "Monday.com write-back not configured (MONDAY_API_TOKEN missing)" });
    return;
  }

  const localId = String(req.params.localId);
  const body = req.body as { columnId?: unknown; value?: unknown };
  const columnId = (body.columnId ?? "").toString();
  const value = (body.value ?? "").toString();
  if (!columnId) {
    res.status(400).json({ error: "columnId is required" });
    return;
  }

  const item = db
    .prepare("SELECT monday_item_id, board_key FROM board_items WHERE local_id = ?")
    .get(localId) as { monday_item_id: string | null; board_key: string } | null;
  if (!item) {
    res.status(404).json({ error: "Board item not found" });
    return;
  }
  if (!item.monday_item_id) {
    res.status(400).json({ error: "Board item has no Monday.com item ID" });
    return;
  }

  const schema = getBoardColumnsFor(db, item.board_key);
  const col = schema?.columns.find((c) => c.columnId === columnId);
  if (!schema || !col) {
    res.status(409).json({ error: "Column schema not synced for this board yet — run a sync first" });
    return;
  }
  if (!SIMPLE_EDITABLE_TYPES.has(col.type)) {
    res.status(400).json({ error: `Column type '${col.type}' is not editable here` });
    return;
  }
  // Choice columns: value must be an existing label (empty clears).
  if (value && CHOICE_TYPES.has(col.type) && !col.options.some((o) => o.label === value)) {
    res.status(400).json({ error: "Value is not a valid option for this column", allowed: col.options.map((o) => o.label) });
    return;
  }

  const mondayItemId = item.monday_item_id; // narrowed; the write closure below can't re-narrow a field

  try {
    const outcome = await withTokenFallback(
      (token) => dataSource.setColumnValue(schema.mondayBoardId, mondayItemId, columnId, value, token),
      writeTokenOptions(req),
    );
    auditFromReq(req, "monday.column_changed", {
      targetType: "board_item", targetId: localId, targetMondayId: mondayItemId,
      metadata: {
        mondayItemId: item.monday_item_id, boardKey: item.board_key, columnId, columnType: col.type, value,
        usedPersonalToken: outcome.usedPersonalToken, fellBackToSharedToken: outcome.fellBackToSharedToken,
      },
    });
    res.json({ data: { localId, columnId, value, pending: false } });
  } catch (err) {
    console.error("[write-back] column change failed; queueing for retry:", err);
    enqueueWrite(db, {
      opType: "change_column", targetTable: "board_items", targetLocalId: localId,
      mondayItemId: item.monday_item_id, authorOid: req.user?.oid ?? null,
      payload: { boardId: schema.mondayBoardId, columnId, value },
    });
    auditFromReq(req, "monday.column_changed", {
      targetType: "board_item", targetId: localId, targetMondayId: mondayItemId,
      metadata: { mondayItemId: item.monday_item_id, boardKey: item.board_key, columnId, columnType: col.type, value, queued: true },
    });
    res.status(202).json({ data: { localId, columnId, value, pending: true } });
  }
});

// =============================================================================
// Create a contract (Fee K) for a client
// =============================================================================
// Creates a new item on the Fee Ks board with the case type + AF/FF/PF amounts,
// named "<client> — <case type>", auto-linked to the client's profile (and their
// Open Forms entries when present). Columns are resolved by title from the synced
// schema (no hardcoded ids). Surcharges are intentionally NOT set here — they're
// a post-signing decision. Same rails: personal token, queue fallback, audit.

app.post("/api/profiles/:localId/contracts", requireAuth, async (req, res) => {
  if (!MONDAY_API_TOKEN) {
    res.status(503).json({ error: "Monday.com write-back not configured" });
    return;
  }
  const localId = String(req.params.localId);
  const body = req.body as { caseType?: unknown; af?: unknown; ff?: unknown; pf?: unknown };
  const caseType = (body.caseType ?? "").toString().trim();
  const num = (v: unknown): number | null => {
    if (v === "" || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const af = num(body.af), ff = num(body.ff), pf = num(body.pf);
  if (!caseType) {
    res.status(400).json({ error: "caseType is required" });
    return;
  }

  const profile = db
    .prepare("SELECT monday_item_id, name FROM profiles WHERE local_id = ?")
    .get(localId) as { monday_item_id: string | null; name: string } | null;
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  const schema = getBoardColumnsFor(db, "fee_ks");
  if (!schema) {
    res.status(409).json({ error: "Fee Ks column schema not synced yet — run a sync first" });
    return;
  }
  const byTitle = (pred: (t: string) => boolean, type?: string) =>
    schema.columns.find((c) => pred(c.title.trim().toLowerCase()) && (!type || c.type === type));
  const caseTypeCol = byTitle((t) => t.startsWith("contract for"), "dropdown");
  const afCol = byTitle((t) => t === "af", "numbers");
  const ffCol = byTitle((t) => t === "ff", "numbers");
  const pfCol = byTitle((t) => t === "pf", "numbers");
  const profileCol = byTitle((t) => t === "profile", "board_relation");
  const openFormsCol = byTitle((t) => t.includes("open forms"), "board_relation");

  if (!caseTypeCol) {
    res.status(409).json({ error: "Could not resolve the 'Contract for...' column on Fee Ks" });
    return;
  }
  if (caseTypeCol.options.length > 0 && !caseTypeCol.options.some((o) => o.label === caseType)) {
    res.status(400).json({ error: "caseType is not a valid option", allowed: caseTypeCol.options.map((o) => o.label) });
    return;
  }

  const columnValues: Record<string, unknown> = { [caseTypeCol.columnId]: { labels: [caseType] } };
  if (afCol && af != null) columnValues[afCol.columnId] = af;
  if (ffCol && ff != null) columnValues[ffCol.columnId] = ff;
  if (pfCol && pf != null) columnValues[pfCol.columnId] = pf;
  if (profileCol && profile.monday_item_id) columnValues[profileCol.columnId] = { item_ids: [Number(profile.monday_item_id)] };
  if (openFormsCol) {
    const ofIds = (db
      .prepare("SELECT monday_item_id FROM board_items WHERE profile_local_id = ? AND board_key = '_cd_open_forms' AND monday_item_id IS NOT NULL")
      .all(localId) as { monday_item_id: string }[]).map((r) => Number(r.monday_item_id)).filter((n) => Number.isFinite(n));
    if (ofIds.length > 0) columnValues[openFormsCol.columnId] = { item_ids: ofIds };
  }

  const itemName = `${profile.name} — ${caseType}`;

  try {
    const outcome = await withTokenFallback(
      (token) => dataSource.createItem(schema.mondayBoardId, itemName, columnValues, token),
      writeTokenOptions(req),
    );
    auditFromReq(req, "monday.contract_created", {
      targetType: "profile", targetId: localId, targetMondayId: profile.monday_item_id,
      metadata: {
        feeKItemId: outcome.result, caseType, af, ff, pf, name: itemName,
        usedPersonalToken: outcome.usedPersonalToken, fellBackToSharedToken: outcome.fellBackToSharedToken,
      },
    });
    res.json({ data: { feeKItemId: outcome.result, name: itemName, pending: false } });
  } catch (err) {
    console.error("[write-back] createItem failed; queueing for retry:", err);
    enqueueWrite(db, {
      opType: "create_item", targetTable: "profiles", targetLocalId: localId,
      mondayItemId: profile.monday_item_id, authorOid: req.user?.oid ?? null,
      payload: { boardId: schema.mondayBoardId, itemName, columnValues },
    });
    auditFromReq(req, "monday.contract_created", {
      targetType: "profile", targetId: localId, targetMondayId: profile.monday_item_id,
      metadata: { caseType, af, ff, pf, name: itemName, queued: true },
    });
    res.status(202).json({ data: { name: itemName, pending: true } });
  }
});

// =============================================================================
// Call Log — quick create + link to a profile
// =============================================================================
// Creates a new item on the real Call Log board, following the front desk's
// existing convention of using the item's name as the note. Columns resolved
// by title from the synced schema (no hardcoded ids), same rails as contract
// creation above: personal token, queue fallback, audit. Unlike contract
// creation, this also inserts the row into board_items immediately (matching
// the shape scripts/sync/mapper.ts produces) so the new call appears in the
// Call Log list right away instead of waiting for the next sync.

let staffDirectoryCache: { users: MondayWorkspaceUser[]; fetchedAt: number } | null = null;
const STAFF_DIRECTORY_TTL_MS = 5 * 60 * 1000;

/**
 * Resolve a Monday numeric user id to their name via the same cache
 * `/api/call-log/staff-directory` populates (refreshed here if stale/empty).
 * Best-effort: a lookup failure just leaves the local mirror blank until the
 * next full sync backfills it — never blocks the write itself.
 */
async function resolveStaffName(userId: number | null): Promise<string | null> {
  if (userId == null) return null;
  const now = Date.now();
  if (!staffDirectoryCache || now - staffDirectoryCache.fetchedAt >= STAFF_DIRECTORY_TTL_MS) {
    try {
      staffDirectoryCache = { users: await fetchWorkspaceUsers(MONDAY_API_TOKEN!), fetchedAt: now };
    } catch (err) {
      console.error("[call-log] resolveStaffName: fetchWorkspaceUsers failed:", err);
      return null;
    }
  }
  return staffDirectoryCache.users.find((u) => Number(u.id) === userId)?.name ?? null;
}

app.get("/api/call-log/staff-directory", async (_req, res) => {
  if (!MONDAY_API_TOKEN) {
    res.status(503).json({ error: "Monday.com not configured" });
    return;
  }
  const now = Date.now();
  if (staffDirectoryCache && now - staffDirectoryCache.fetchedAt < STAFF_DIRECTORY_TTL_MS) {
    res.json({ data: staffDirectoryCache.users });
    return;
  }
  try {
    const users = await fetchWorkspaceUsers(MONDAY_API_TOKEN);
    staffDirectoryCache = { users, fetchedAt: now };
    res.json({ data: users });
  } catch (err) {
    console.error("[call-log] fetchWorkspaceUsers failed:", err);
    res.status(502).json({ error: "Could not load Monday.com users" });
  }
});

app.post("/api/call-log", requireAuth, async (req, res) => {
  if (!MONDAY_API_TOKEN) {
    res.status(503).json({ error: "Monday.com write-back not configured" });
    return;
  }

  const body = req.body as {
    name?: unknown; note?: unknown; phone?: unknown; status?: unknown; language?: unknown;
    profileLocalId?: unknown; takenByUserId?: unknown; highlightedForUserId?: unknown; mentionedUserIds?: unknown;
  };
  const name = (body.name ?? "").toString().trim();
  const note = (body.note ?? "").toString().trim();
  const phone = (body.phone ?? "").toString().trim();
  const language = (body.language ?? "").toString().trim();
  const profileLocalId = body.profileLocalId ? String(body.profileLocalId) : null;
  const toId = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const takenByUserId = toId(body.takenByUserId);
  const highlightedForUserId = toId(body.highlightedForUserId);
  const noteMentions: UpdateMention[] = Array.isArray(body.mentionedUserIds)
    ? body.mentionedUserIds.filter((id): id is string | number => id != null && id !== "").map((id) => ({ id: String(id), type: "User" as const }))
    : [];

  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const schema = getBoardColumnsFor(db, "call_log");
  if (!schema) {
    res.status(409).json({ error: "Call Log column schema not synced yet — run a sync first" });
    return;
  }
  const byTitle = (t: string) => schema.columns.find((c) => c.title.trim().toLowerCase() === t.toLowerCase());
  const phoneCol = byTitle("Phone");
  const statusCol = byTitle("Status");
  const dateCol = byTitle("Date");
  const languageCol = byTitle("Language");
  const takenByCol = byTitle("Taken by");
  const highlightedForCol = byTitle("Highlighted For");
  const profileCol = byTitle("link to Profiles");

  const statusDef = getBoardStatusOptionsFor(db, "call_log");
  const requestedStatus = (body.status ?? "").toString().trim();
  const status =
    requestedStatus ||
    statusDef?.options.find((o) => o.label.toLowerCase() === "pending")?.label ||
    statusDef?.options[0]?.label ||
    null;
  if (requestedStatus && statusDef && !statusDef.options.some((o) => o.label === requestedStatus)) {
    res.status(400).json({ error: "status is not a valid option", allowed: statusDef.options.map((o) => o.label) });
    return;
  }
  // Validated against the synced schema, same as status above — the modal's
  // hardcoded LANGUAGE_OPTIONS list is just a starting point and can drift
  // from Monday's real labels, and create_labels_if_missing:false means a
  // mismatch would otherwise fail the create_item mutation permanently.
  if (language && languageCol && languageCol.options.length > 0 && !languageCol.options.some((o) => o.label === language)) {
    res.status(400).json({ error: "language is not a valid option", allowed: languageCol.options.map((o) => o.label) });
    return;
  }

  let profile: { monday_item_id: string | null; name: string; batch_id: number } | null = null;
  if (profileLocalId) {
    profile = db.prepare("SELECT monday_item_id, name, batch_id FROM profiles WHERE local_id = ?").get(profileLocalId) as
      | { monday_item_id: string | null; name: string; batch_id: number }
      | null;
    if (!profile) {
      res.status(404).json({ error: "Linked profile not found" });
      return;
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const nowTime = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  // Column values for Monday's create_item mutation — keyed by real column id.
  const columnValues: Record<string, unknown> = {};
  if (phoneCol && phone) columnValues[phoneCol.columnId] = phone;
  if (statusCol && status) columnValues[statusCol.columnId] = { label: status };
  if (dateCol) columnValues[dateCol.columnId] = today;
  if (languageCol && language) columnValues[languageCol.columnId] = { label: language };
  if (takenByCol && takenByUserId) columnValues[takenByCol.columnId] = { personsAndTeams: [{ id: takenByUserId, kind: "person" }] };
  if (highlightedForCol && highlightedForUserId) {
    columnValues[highlightedForCol.columnId] = { personsAndTeams: [{ id: highlightedForUserId, kind: "person" }] };
  }
  if (profileCol && profile?.monday_item_id) columnValues[profileCol.columnId] = { item_ids: [Number(profile.monday_item_id)] };

  // Resolved up front so a Monday outage below still lets the call get logged
  // locally with a readable "Taken by"/"Highlighted for" — best-effort, a
  // lookup failure just leaves those blank until the next full sync.
  const [takenByName, highlightedForName] = await Promise.all([
    resolveStaffName(takenByUserId),
    resolveStaffName(highlightedForUserId),
  ]);

  // Mirrors scripts/sync/mapper.ts's shapeColumnValue() output — keyed by the
  // logical config keys in config/boards.yaml, not Monday's real column ids —
  // so this row reads back exactly like one the next sync would have written.
  const mirroredColumnValues: Record<string, unknown> = {
    ...(phone ? { phone } : {}),
    ...(status ? { status: { label: status } } : {}),
    date: { date: today },
    hour: nowTime,
    ...(language ? { language: { label: language } } : {}),
    ...(takenByName ? { taken_by: { label: takenByName } } : {}),
    ...(highlightedForName ? { highlighted_for: { label: highlightedForName } } : {}),
    last_updated: new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC"),
  };

  // "topics" is the Monday group id (title "Call Log") the front desk actively
  // logs into — the board's other groups ("Pending Calls", "Voicemail
  // Archive"/"Voicemails") are a different, unrelated flow. Without an explicit
  // group_id, create_item falls back to the board's default group, which is
  // not guaranteed to be this one.
  const CALL_LOG_GROUP_ID = "topics";
  const CALL_LOG_GROUP_TITLE = "Call Log";

  // Custom activity type created one-time via create_custom_activity — see
  // docs/decisions.md. Monday's built-in "Call summary" Essentials preset has
  // no API-visible id, so this is a separate (but identically-labeled) type.
  const CALL_SUMMARY_ACTIVITY_ID = "eac83484-1fd4-432c-b9eb-755abb48efe7";

  const localId = randomUUID();
  const insertLocal = (mondayItemId: string | null, syncStatus: "synced" | "pending") =>
    db
      .prepare(`
        INSERT INTO board_items
          (batch_id, local_id, monday_item_id, board_key, group_title, name, status,
           next_date, next_time, attorney, paralegals, profile_local_id, column_values,
           updated_at_source, sync_status, created_at, synced_at, last_seen_at)
        VALUES (NULL, ?, ?, 'call_log', ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, datetime('now'), ?, datetime('now'))
      `)
      .run(
        localId, mondayItemId, CALL_LOG_GROUP_TITLE, name, status, profileLocalId ?? "", JSON.stringify(mirroredColumnValues),
        new Date().toISOString(), syncStatus, syncStatus === "synced" ? new Date().toISOString() : null,
      );

  // The note becomes THREE separate Monday artifacts when there's a linked
  // profile, each posted independently and each best-effort (the call itself
  // is already logged by this point, so none of these failing should fail the
  // whole request — they queue and retry instead):
  //   1. A comment on the call log entry itself (postCallLogNote).
  //   2. A comment directly on the CLIENT'S OWN profile item (postProfileNote)
  //      — this is the one mirrored into client_updates, since that table
  //      represents the profile's real Monday-side update thread; mirroring
  //      the call-log-item comment there would have been misleading (it
  //      never actually existed on the profile in Monday, only locally).
  //   3. A "Call Summary" Activities entry on the profile (postActivityLog).
  const authorName = req.user?.name ?? req.user?.preferred_username ?? "Staff";
  const authorEmail = req.user?.email ?? req.user?.preferred_username ?? null;

  const postCallLogNote = async (mondayItemId: string) => {
    if (!note) return;
    try {
      await withTokenFallback((token) => dataSource.postUpdate(mondayItemId, note, token, undefined, noteMentions), writeTokenOptions(req));
    } catch (err) {
      console.error("[write-back] call log postUpdate (on call entry) failed; queueing for retry:", err);
      enqueueWrite(db, {
        opType: "create_update", targetTable: "board_items", targetLocalId: localId,
        mondayItemId, authorOid: req.user?.oid ?? null,
        payload: { body: note, mentions: noteMentions },
      });
    }
  };

  const postProfileNote = async () => {
    if (!note || !profile?.monday_item_id) return;
    const profileMondayItemId = profile.monday_item_id;
    const noteLocalId = randomUUID();
    const now = new Date().toISOString();
    try {
      const outcome = await withTokenFallback(
        (token) => dataSource.postUpdate(profileMondayItemId, note, token),
        writeTokenOptions(req),
      );
      db.prepare(`
        INSERT INTO client_updates
          (batch_id, local_id, monday_update_id, profile_local_id, board_item_local_id,
           board_key, author_name, author_email, text_body, body_html, source_type,
           reply_to_update_id, created_at_source, sync_status)
        VALUES (?, ?, ?, ?, ?, 'call_log', ?, ?, ?, NULL, 'update', NULL, ?, 'synced')
      `).run(profile.batch_id, noteLocalId, outcome.result, profileLocalId, localId, authorName, authorEmail, note, now);
    } catch (err) {
      console.error("[write-back] call log postUpdate (on profile) failed; queueing for retry:", err);
      db.prepare(`
        INSERT INTO client_updates
          (batch_id, local_id, monday_update_id, profile_local_id, board_item_local_id,
           board_key, author_name, author_email, text_body, body_html, source_type,
           reply_to_update_id, created_at_source, sync_status)
        VALUES (?, ?, NULL, ?, ?, 'call_log', ?, ?, ?, NULL, 'update', NULL, ?, 'pending')
      `).run(profile.batch_id, noteLocalId, profileLocalId, localId, authorName, authorEmail, note, now);
      enqueueWrite(db, {
        opType: "create_update", targetTable: "profiles", targetLocalId: profileLocalId,
        mondayItemId: profileMondayItemId, authorOid: req.user?.oid ?? null,
        payload: { body: note },
      });
    }
  };

  // A "Call Summary" activity on the linked profile, on top of the comment
  // above — see docs/decisions.md, 2026-08-25. Only meaningful when there's
  // both a note and a linked profile with a real Monday item id.
  const activityLogInput: CreateTimelineItemInput | null =
    profile?.monday_item_id && note
      ? {
          itemId: profile.monday_item_id,
          title: `Call: ${name}`,
          customActivityId: CALL_SUMMARY_ACTIVITY_ID,
          content: note,
          phone: phone || undefined,
          userId: takenByUserId ?? undefined,
        }
      : null;
  const postActivityLog = async () => {
    if (!activityLogInput) return;
    try {
      await withTokenFallback(
        (token) => dataSource.createTimelineItem(activityLogInput, token),
        writeTokenOptions(req),
      );
    } catch (err) {
      console.error("[write-back] call log createTimelineItem failed; queueing for retry:", err);
      enqueueWrite(db, {
        opType: "create_timeline_item", targetTable: "board_items", targetLocalId: localId,
        mondayItemId: activityLogInput.itemId, authorOid: req.user?.oid ?? null,
        payload: { ...activityLogInput },
      });
    }
  };

  try {
    const outcome = await withTokenFallback(
      (token) => dataSource.createItem(schema.mondayBoardId, name, columnValues, token, CALL_LOG_GROUP_ID),
      writeTokenOptions(req),
    );
    insertLocal(outcome.result, "synced");
    // Independent Monday writes — none depends on another's result, so they
    // run concurrently to keep this quick-log popup fast.
    await Promise.all([postCallLogNote(outcome.result), postProfileNote(), postActivityLog()]);
    auditFromReq(req, "monday.call_logged", {
      targetType: "board_item", targetId: localId, targetMondayId: outcome.result,
      metadata: {
        mondayItemId: outcome.result, profileLocalId, status, name, hasNote: !!note,
        usedPersonalToken: outcome.usedPersonalToken, fellBackToSharedToken: outcome.fellBackToSharedToken,
      },
    });
    res.json({ data: { localId, mondayItemId: outcome.result, name, status, profileLocalId, pending: false } });
  } catch (err) {
    console.error("[write-back] call log createItem failed; queueing for retry:", err);
    insertLocal(null, "pending");
    // The note can't be posted until the item exists — carried in the queued
    // payload so the write-queue processor posts it right after the retried
    // create_item succeeds (see write-queue/processor.ts's "create_item" case).
    enqueueWrite(db, {
      opType: "create_item", targetTable: "board_items", targetLocalId: localId,
      mondayItemId: null, authorOid: req.user?.oid ?? null,
      payload: { boardId: schema.mondayBoardId, itemName: name, columnValues, groupId: CALL_LOG_GROUP_ID, note: note || undefined },
    });
    // Unlike the call-log-entry comment, the profile note and activity log
    // only need the linked profile's (already-known) item id — neither
    // depends on the new call item existing, so neither is tied to the
    // create_item retry above. They're independent of each other too.
    await Promise.all([postProfileNote(), postActivityLog()]);
    auditFromReq(req, "monday.call_logged", {
      targetType: "board_item", targetId: localId, targetMondayId: null,
      metadata: { profileLocalId, status, name, hasNote: !!note, queued: true },
    });
    res.status(202).json({ data: { localId, mondayItemId: null, name, status, profileLocalId, pending: true } });
  }
});

// =============================================================================
// Call Log — edit an existing entry (name, phone, linked client, highlighted for)
// =============================================================================
// Partial update: only fields present in the body are touched. Bespoke (not the
// generic /api/board-items/:localId/columns PATCH) because the item's name isn't
// a synced column and the profile-link/highlighted-for writes need Monday's
// JSON-valued change_column_value, not the generic endpoint's string-only path.
// Same rails as every other write-back here: personal token → shared token
// fallback → durable queue, applied optimistically to the local mirror either way.

app.patch("/api/call-log/:localId", requireAuth, async (req, res) => {
  if (!MONDAY_API_TOKEN) {
    res.status(503).json({ error: "Monday.com write-back not configured" });
    return;
  }

  const localId = String(req.params.localId);
  const item = db
    .prepare("SELECT monday_item_id, name, profile_local_id, column_values FROM board_items WHERE local_id = ? AND board_key = 'call_log'")
    .get(localId) as { monday_item_id: string | null; name: string; profile_local_id: string | null; column_values: string } | null;
  if (!item) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  if (!item.monday_item_id) {
    res.status(400).json({ error: "Call has no Monday.com item ID yet — cannot edit until the create finishes syncing" });
    return;
  }
  const mondayItemId = item.monday_item_id; // narrowed; the write closures below can't re-narrow a field

  const body = req.body as { name?: unknown; phone?: unknown; profileLocalId?: unknown; highlightedForUserId?: unknown };
  const hasName = "name" in body;
  const hasPhone = "phone" in body;
  const hasProfile = "profileLocalId" in body;
  const hasHighlightedFor = "highlightedForUserId" in body;
  if (!hasName && !hasPhone && !hasProfile && !hasHighlightedFor) {
    res.status(400).json({ error: "No editable fields provided" });
    return;
  }

  const name = hasName ? (body.name ?? "").toString().trim() : undefined;
  if (hasName && !name) {
    res.status(400).json({ error: "name cannot be empty" });
    return;
  }
  const phone = hasPhone ? (body.phone ?? "").toString().trim() : undefined;
  const profileLocalId = hasProfile ? (body.profileLocalId ? String(body.profileLocalId) : null) : undefined;
  const highlightedForUserId = hasHighlightedFor
    ? (body.highlightedForUserId == null || body.highlightedForUserId === "" ? null : Number(body.highlightedForUserId))
    : undefined;

  const schema = getBoardColumnsFor(db, "call_log");
  if (!schema) {
    res.status(409).json({ error: "Call Log column schema not synced yet — run a sync first" });
    return;
  }
  const byTitle = (t: string) => schema.columns.find((c) => c.title.trim().toLowerCase() === t.toLowerCase());
  const phoneCol = byTitle("Phone");
  const profileCol = byTitle("link to Profiles");
  const highlightedForCol = byTitle("Highlighted For");

  let newProfile: { monday_item_id: string | null; name: string } | null = null;
  if (hasProfile && profileLocalId) {
    newProfile = db.prepare("SELECT monday_item_id, name FROM profiles WHERE local_id = ?").get(profileLocalId) as
      | { monday_item_id: string | null; name: string }
      | null;
    if (!newProfile) {
      res.status(404).json({ error: "Linked profile not found" });
      return;
    }
  }

  const authorOid = req.user?.oid ?? null;
  let anyQueued = false;

  const writeName = async () => {
    if (!hasName || name === item.name) return;
    try {
      await withTokenFallback(
        (token) => dataSource.setColumnValue(schema.mondayBoardId, mondayItemId, "name", name!, token),
        writeTokenOptions(req),
      );
    } catch (err) {
      console.error("[write-back] call log rename failed; queueing for retry:", err);
      anyQueued = true;
      enqueueWrite(db, {
        opType: "change_column", targetTable: "board_items", targetLocalId: localId,
        mondayItemId, authorOid, payload: { boardId: schema.mondayBoardId, columnId: "name", value: name },
      });
    }
  };

  const writePhone = async () => {
    if (!hasPhone || !phoneCol) return;
    try {
      await withTokenFallback(
        (token) => dataSource.setColumnValue(schema.mondayBoardId, mondayItemId, phoneCol.columnId, phone!, token),
        writeTokenOptions(req),
      );
    } catch (err) {
      console.error("[write-back] call log phone update failed; queueing for retry:", err);
      anyQueued = true;
      enqueueWrite(db, {
        opType: "change_column", targetTable: "board_items", targetLocalId: localId,
        mondayItemId, authorOid, payload: { boardId: schema.mondayBoardId, columnId: phoneCol.columnId, value: phone },
      });
    }
  };

  const writeProfile = async () => {
    if (!hasProfile || !profileCol) return;
    const value = { item_ids: newProfile?.monday_item_id ? [Number(newProfile.monday_item_id)] : [] };
    try {
      await withTokenFallback(
        (token) => dataSource.setColumnValueJson(schema.mondayBoardId, mondayItemId, profileCol.columnId, value, token),
        writeTokenOptions(req),
      );
    } catch (err) {
      console.error("[write-back] call log profile link failed; queueing for retry:", err);
      anyQueued = true;
      enqueueWrite(db, {
        opType: "change_column_json", targetTable: "board_items", targetLocalId: localId,
        mondayItemId, authorOid, payload: { boardId: schema.mondayBoardId, columnId: profileCol.columnId, value },
      });
    }
  };

  const writeHighlightedFor = async () => {
    if (!hasHighlightedFor || !highlightedForCol) return;
    const value = { personsAndTeams: highlightedForUserId ? [{ id: highlightedForUserId, kind: "person" }] : [] };
    try {
      await withTokenFallback(
        (token) => dataSource.setColumnValueJson(schema.mondayBoardId, mondayItemId, highlightedForCol.columnId, value, token),
        writeTokenOptions(req),
      );
    } catch (err) {
      console.error("[write-back] call log highlighted-for update failed; queueing for retry:", err);
      anyQueued = true;
      enqueueWrite(db, {
        opType: "change_column_json", targetTable: "board_items", targetLocalId: localId,
        mondayItemId, authorOid, payload: { boardId: schema.mondayBoardId, columnId: highlightedForCol.columnId, value },
      });
    }
  };

  await Promise.all([writeName(), writePhone(), writeProfile(), writeHighlightedFor()]);

  // Apply locally regardless of whether each Monday write above succeeded or
  // was queued — same optimistic-update pattern as every other write-back
  // handler in this file; a queued write still shows the new value while it
  // retries in the background.
  let cv: Record<string, unknown> = {};
  try {
    cv = JSON.parse(item.column_values) as Record<string, unknown>;
  } catch {
    // leave cv empty
  }
  if (hasPhone) cv.phone = phone || undefined;
  let highlightedForName: string | null = null;
  if (hasHighlightedFor) {
    highlightedForName = await resolveStaffName(highlightedForUserId ?? null);
    if (highlightedForName) cv.highlighted_for = { label: highlightedForName };
    else delete cv.highlighted_for;
  }

  db.prepare(`UPDATE board_items SET name = ?, profile_local_id = ?, column_values = ? WHERE local_id = ?`).run(
    hasName ? name : item.name,
    hasProfile ? (profileLocalId ?? "") : item.profile_local_id,
    JSON.stringify(cv),
    localId,
  );

  auditFromReq(req, "monday.call_edited", {
    targetType: "board_item", targetId: localId, targetMondayId: mondayItemId,
    metadata: {
      mondayItemId,
      fieldsChanged: { name: hasName, phone: hasPhone, profileLocalId: hasProfile, highlightedForUserId: hasHighlightedFor },
      queued: anyQueued,
    },
  });

  res.status(anyQueued ? 202 : 200).json({
    data: {
      localId,
      name: hasName ? name : item.name,
      phone: hasPhone ? (phone || null) : undefined,
      profileLocalId: hasProfile ? (profileLocalId ?? null) : undefined,
      profileName: hasProfile ? (newProfile?.name ?? null) : undefined,
      highlightedFor: hasHighlightedFor ? highlightedForName : undefined,
      pending: anyQueued,
    },
  });
});

// =============================================================================
// Call Log — view/add notes (the item's real Monday.com comment thread)
// =============================================================================
// A call's note has always just been a Monday comment (create_update) posted
// at logging time — never mirrored locally. Rather than add a local field or
// a new Monday column (both real trade-offs, see docs/decisions.md), this
// reads/writes that same thread live and on demand: GET fetches it fresh from
// Monday every time, and adding a note posts a threaded reply
// (create_update's parent_id) onto the oldest existing top-level update, or a
// fresh top-level update if there isn't one yet — exactly mirroring what
// happens today when a call is first logged with a note.

/** Monday's update `body` is HTML; strip it to plain text for display. Mirrors
 * scripts/sync/index.ts's stripHtml (not exported/importable from a script). */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/﻿/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function shapeNoteEntry(u: { id: string; body: string; created_at: string; creator: { name: string } | null; replies?: { id: string; body: string; created_at: string; creator: { name: string } | null }[] }) {
  return {
    id: u.id,
    body: stripHtml(u.body),
    createdAt: u.created_at,
    authorName: u.creator?.name ?? null,
    replies: (u.replies ?? []).map((r) => ({
      id: r.id, body: stripHtml(r.body), createdAt: r.created_at, authorName: r.creator?.name ?? null,
    })),
  };
}

function loadCallLogItemOr404(res: import("express").Response, localId: string): { monday_item_id: string } | null {
  const item = db
    .prepare("SELECT monday_item_id FROM board_items WHERE local_id = ? AND board_key = 'call_log'")
    .get(localId) as { monday_item_id: string | null } | null;
  if (!item) {
    res.status(404).json({ error: "Call not found" });
    return null;
  }
  if (!item.monday_item_id) {
    res.status(400).json({ error: "Call has no Monday.com item ID yet — cannot load notes until the create finishes syncing" });
    return null;
  }
  return { monday_item_id: item.monday_item_id };
}

app.get("/api/call-log/:localId/notes", requireAuth, async (req, res) => {
  if (!MONDAY_API_TOKEN) {
    res.status(503).json({ error: "Monday.com not configured" });
    return;
  }
  const localId = String(req.params.localId);
  const item = loadCallLogItemOr404(res, localId);
  if (!item) return;

  try {
    const byItem = await fetchItemUpdatesBatch([item.monday_item_id], 50);
    const updates = (byItem.get(item.monday_item_id) ?? [])
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map(shapeNoteEntry);
    res.json({ data: { updates } });
  } catch (err) {
    console.error("[call-log] fetchItemUpdatesBatch failed:", err);
    res.status(502).json({ error: "Could not load notes from Monday.com" });
  }
});

app.post("/api/call-log/:localId/notes", requireAuth, async (req, res) => {
  if (!MONDAY_API_TOKEN) {
    res.status(503).json({ error: "Monday.com write-back not configured" });
    return;
  }
  const localId = String(req.params.localId);
  const item = loadCallLogItemOr404(res, localId);
  if (!item) return;
  const mondayItemId = item.monday_item_id;

  const notesBody = req.body as { note?: unknown; mentionedUserIds?: unknown };
  const note = (notesBody.note ?? "").toString().trim();
  if (!note) {
    res.status(400).json({ error: "note is required" });
    return;
  }
  const mentions: UpdateMention[] = Array.isArray(notesBody.mentionedUserIds)
    ? notesBody.mentionedUserIds.filter((id): id is string | number => id != null && id !== "").map((id) => ({ id: String(id), type: "User" as const }))
    : [];

  // Reply under the oldest existing top-level update (the original note, if
  // any) so this stays one conversation instead of a new top-level comment
  // every time; re-fetched fresh rather than trusting a stale client-held id.
  let parentId: string | undefined;
  try {
    const byItem = await fetchItemUpdatesBatch([mondayItemId], 50);
    const existing = byItem.get(mondayItemId) ?? [];
    if (existing.length > 0) {
      parentId = existing.slice().sort((a, b) => a.created_at.localeCompare(b.created_at))[0]!.id;
    }
  } catch (err) {
    console.error("[call-log] fetchItemUpdatesBatch (for reply parent) failed; posting as a fresh top-level update:", err);
  }

  let queued = false;
  try {
    await withTokenFallback(
      (token) => dataSource.postUpdate(mondayItemId, note, token, parentId, mentions),
      writeTokenOptions(req),
    );
  } catch (err) {
    console.error("[write-back] call log note failed; queueing for retry:", err);
    queued = true;
    enqueueWrite(db, {
      opType: "create_update", targetTable: "board_items", targetLocalId: localId,
      mondayItemId, authorOid: req.user?.oid ?? null,
      payload: { body: note, parentId, mentions },
    });
  }

  auditFromReq(req, "monday.call_note_added", {
    targetType: "board_item", targetId: localId, targetMondayId: mondayItemId,
    metadata: { mondayItemId, replyTo: parentId ?? null, queued },
  });

  res.status(queued ? 202 : 200).json({ data: { pending: queued } });
});

// =============================================================================
// Document generation — render a DOCX for a profile from live Monday.com data
// =============================================================================
// Same pipeline as the CLI `render` command: fetch the item from Monday.com,
// resolve columns per config/boards.yaml, map to template variables, fill the
// .docx template. Streams the file back as a download; nothing is written to
// disk on the server.

app.post("/api/profiles/:localId/render", requireAuth, async (req, res) => {
  if (!MONDAY_API_TOKEN) {
    res.status(503).json({ error: "Document generation not configured (MONDAY_API_TOKEN missing)" });
    return;
  }

  const localId = String(req.params.localId);
  const templateName = (((req.body ?? {}) as { template?: unknown }).template ?? "client_letter_docx").toString();

  const profile = db
    .prepare("SELECT name, monday_item_id FROM profiles WHERE local_id = ?")
    .get(localId) as { name: string; monday_item_id: string | null } | null;

  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  if (!profile.monday_item_id) {
    res.status(400).json({ error: "Profile has no Monday.com item ID — cannot generate a document" });
    return;
  }

  try {
    const config = await loadConfig({
      boardsPath: path.join(REPO_ROOT, "config/boards.yaml"),
      templatesPath: path.join(REPO_ROOT, "config/templates.yaml"),
    });

    const templateConfig = config.templates[templateName];
    if (!templateConfig) {
      const available = Object.keys(config.templates).join(", ");
      res.status(400).json({ error: `Unknown template "${templateName}". Available: ${available}` });
      return;
    }
    if (!templateConfig.path.endsWith(".docx")) {
      res.status(400).json({ error: `Template "${templateName}" is not a .docx — only Word templates can be generated from the dashboard` });
      return;
    }
    const boardConfig = config.boards[templateConfig.source_board];
    if (!boardConfig) {
      res.status(500).json({ error: `Template source board "${templateConfig.source_board}" missing from boards.yaml` });
      return;
    }

    const board = await fetchBoardStructure(boardConfig.id);
    const resolvedColumns = resolveAllColumns(board.columns, boardConfig, {});
    const item = await fetchItem(profile.monday_item_id);
    const vars = mapItemToTemplateVars(item, templateConfig, resolvedColumns);

    const validation = validateTemplateVars(vars, templateConfig);
    if (!validation.valid) {
      res.status(422).json({ error: `Missing required data: ${validation.errors.join("; ")}` });
      return;
    }

    const templateBuffer = fs.readFileSync(path.join(REPO_ROOT, templateConfig.path));
    const docx = renderDocxTemplate(templateBuffer, vars);

    auditFromReq(req, "doc.generated", {
      targetType: "profile",
      targetId: localId,
      targetMondayId: profile.monday_item_id,
      metadata: { template: templateName, mondayItemId: profile.monday_item_id },
    });

    const safeName = profile.name.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 40) || "document";
    const stamp = new Date().toISOString().slice(0, 10);
    res.status(200);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}-${stamp}.docx"`);
    res.send(docx);
  } catch (err) {
    console.error("[render] doc generation failed:", err);
    res.status(502).json({ error: "Could not generate the document — Monday.com fetch or template render failed" });
  }
});

// =============================================================================
// Settings — Attorney Boards
// =============================================================================

app.get("/api/settings/attorney-boards", (_req, res) => {
  res.json({ data: loadAttorneyBoards() });
});

app.post("/api/settings/attorney-boards", requireAdmin, (req, res) => {
  const { boardKey, mondayBoardId, displayName } = req.body as Partial<AttorneyBoard>;

  if (!boardKey || !displayName) {
    res.status(400).json({ error: "boardKey and displayName are required" });
    return;
  }
  if (!/^appointments_[a-z0-9_]+$/.test(boardKey)) {
    res.status(400).json({ error: "boardKey must match appointments_<letters> (e.g. appointments_js)" });
    return;
  }

  const boards = loadAttorneyBoards();
  if (boards.find((b) => b.boardKey === boardKey)) {
    res.status(409).json({ error: `Board key "${boardKey}" already exists` });
    return;
  }

  const newBoard: AttorneyBoard = {
    boardKey,
    mondayBoardId: mondayBoardId ?? "",
    displayName,
    active: true,
  };
  boards.push(newBoard);
  saveAttorneyBoards(boards);
  auditFromReq(req, "attorney_board.added", {
    targetType: "attorney_board",
    targetId: boardKey,
    metadata: { mondayBoardId: newBoard.mondayBoardId, displayName },
  });
  res.json({ data: boards });
});

app.delete("/api/settings/attorney-boards/:boardKey", requireAdmin, (req, res) => {
  const { boardKey } = req.params;
  const boards = loadAttorneyBoards();
  const idx = boards.findIndex((b) => b.boardKey === boardKey);
  if (idx === -1) {
    res.status(404).json({ error: `Board key "${boardKey}" not found` });
    return;
  }
  boards.splice(idx, 1);
  saveAttorneyBoards(boards);
  auditFromReq(req, "attorney_board.removed", {
    targetType: "attorney_board",
    targetId: String(boardKey),
  });
  res.json({ data: boards });
});

// =============================================================================
// Settings — Dashboard KPI display columns (firm-wide defaults)
// =============================================================================
// Readable by anyone (the dashboard needs it to explain what "default" means);
// writable only by admins, since it changes the view for every user who hasn't
// picked their own column.

app.get("/api/settings/kpi-columns", (_req, res) => {
  res.json({ data: loadGlobalKpiColumns() });
});

app.put("/api/settings/kpi-columns", requireAdmin, (req, res) => {
  const body = req.body as { columns?: unknown };
  if (typeof body?.columns !== "object" || body.columns === null || Array.isArray(body.columns)) {
    res.status(400).json({ error: "columns must be an object of { cardKey: columnId }" });
    return;
  }
  // The whole map is replaced, so the client must send every card it wants kept.
  const saved = saveGlobalKpiColumns(body.columns as Record<string, string>);
  auditFromReq(req, "kpi_columns.updated", {
    targetType: "settings",
    targetId: "kpi-columns",
    metadata: saved,
  });
  res.json({ data: saved });
});

// =============================================================================
// Settings — Status tag overrides (firm-wide label + color per Monday status)
// =============================================================================
// Readable by anyone (the web needs it to render badges); writable only by
// admins, audited. `status-catalog` enumerates the distinct statuses that exist
// in the synced data so the editor can list what there is to override.

app.get("/api/settings/status-overrides", (_req, res) => {
  res.json({ data: loadStatusOverrides() });
});

app.put("/api/settings/status-overrides", requireAdmin, (req, res) => {
  try {
    const saved = saveStatusOverrides(req.body);
    auditFromReq(req, "status_overrides.updated", {
      targetType: "settings",
      targetId: "status-overrides",
      metadata: { count: Object.keys(saved).length },
    });
    res.json({ data: saved });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get("/api/settings/urgency", (_req, res) => {
  res.json({ data: loadUrgencySettings() });
});

app.put("/api/settings/urgency", requireAdmin, (req, res) => {
  const saved = saveUrgencySettings(req.body);
  auditFromReq(req, "urgency_settings.updated", {
    targetType: "settings",
    targetId: "urgency",
    metadata: saved,
  });
  res.json({ data: saved });
});

// Per-board status column options (labels + native Monday colors) for the status
// editor. Any authed user — needed to render/choose statuses inline.
app.get("/api/boards/status-options", (_req, res) => {
  res.json({ data: getBoardStatusOptions(db) });
});
// Full per-board column schema (all columns + choice options) for the
// all-columns expand/edit view. Any authed user.
app.get("/api/boards/columns", (_req, res) => {
  res.json({ data: getBoardColumns(db) });
});
app.get("/api/settings/status-catalog", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) AS count FROM board_items
       WHERE status IS NOT NULL AND status <> ''
       GROUP BY status ORDER BY count DESC`,
    )
    .all() as Array<{ status: string; count: number }>;
  res.json({ data: rows });
});

// Health check — cheap liveness/readiness probe for container orchestration.
// Confirms the DB handle is alive; intentionally outside /api so it is trivial
// to point a Docker HEALTHCHECK / load balancer at it.
app.get("/health", (_req, res) => {
  try {
    db.prepare("SELECT 1").get();
    // `version` = the API image's baked commit SHA (set in Dockerfile.api). Lets
    // us confirm the running backend build without auth.
    //
    // `disk` exists because on 2026-08-17 the disk reached 100%, the daily
    // backup had been failing silently for a week, and this endpoint answered
    // "ok" throughout — it only ever ran SELECT 1. The condition that caused
    // the July corruptions was invisible from outside right up to the moment
    // someone thought to look.
    //
    // Reported as a coarse level, not free bytes: /health sits outside auth, so
    // it should raise the alarm without publishing the machine's capacity. The
    // status stays 200 in every case — the container healthcheck treats a
    // non-2xx as "restart me", and restart-looping the API because a disk is
    // filling would turn a warning into an outage.
    res.status(200).json({
      status: "ok",
      db: DB_SOURCE,
      version: process.env.BUILD_SHA ?? "dev",
      disk: diskLevel(DATA_DIR),
    });
  } catch (err) {
    // Log the detail server-side; don't leak internals (paths, driver errors)
    // in the response — /health is outside auth and reachable by the proxy.
    console.error("[health] db check failed:", err);
    res.status(503).json({ status: "error" });
  }
});

// Unknown /api/ routes → 404
app.use("/api/", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Global error handler — any thrown/rejected handler lands here. Log the detail
// server-side and return a generic JSON 500 so stack traces never leak.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[error]", err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
});


const PORT = Number(process.env.PORT ?? 3000);
// Bind to loopback by default. The API serves client PII, so locally it must
// not be reachable from other hosts. Inside a container
// (behind nginx, with no published port) set HOST=0.0.0.0 so the proxy can reach
// it on the compose network.
const HOST = process.env.HOST ?? "127.0.0.1";
const server = app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);

  if (DB_SOURCE === "live") {
    scheduleNightlySync();
    scheduleWalCheckpoint();
    scheduleBackups();
    if (MONDAY_API_TOKEN) {
      // Drain queued Monday.com write-backs in the background, with retries.
      startWriteQueueProcessor(db, {
        token: MONDAY_API_TOKEN,
        resolveUserToken: getUserMondayToken,
        reportTokenRejected: markMondayTokenRejected,
      });

      // Refresh board/column schema in the background so the editors work right
      // after a deploy without a manual data sync. Light (structure only) and
      // non-blocking; a failure leaves the last-good schema in place.
      refreshBoardSchema(db)
        .then((r) => console.log(`[schema-refresh] board schema refreshed: ${r.boards} boards${r.failed ? `, ${r.failed} failed` : ""}`))
        .catch((e) => console.error("[schema-refresh] failed:", e));

      // Drain Monday webhook events (near-real-time mirror freshness). Only
      // useful once webhooks are registered — see scripts/setup-webhooks.ts
      // and docs/webhooks.md. Board refreshes ride the same runSync guard as
      // the scheduled syncs, so they can never overlap one.
      if (webhookSecret()) {
        createBoardKeyResolver(DATA_DIR)
          .then((boardKeyForId) => {
            startWebhookProcessor(db, {
              boardKeyForId,
              runTargetedSync: (boards) =>
                runSync("webhook", ["--skip-timeline", `--boards=${boards.join(",")}`]),
            });
          })
          .catch((e) => console.error("[webhooks] processor not started:", e));
      } else {
        console.log("[webhooks] receiver disabled (set MONDAY_WEBHOOK_SECRET to enable).");
      }
    }
  }
});

// =============================================================================
// Graceful shutdown — Docker `stop` sends SIGTERM. Stop accepting connections,
// checkpoint the WAL into the main DB file, then close cleanly so the .db is
// self-contained (no orphaned -wal) for the next start or a backup.
// =============================================================================

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received — draining…`);
  server.close(() => {
    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
      db.close();
      usersDb.pragma("wal_checkpoint(TRUNCATE)");
      usersDb.close();
      console.log("[shutdown] databases checkpointed and closed.");
    } catch (err) {
      console.error("[shutdown] error closing database:", err);
    }
    process.exit(0);
  });
  // Failsafe: force-exit if connections don't drain in time.
  setTimeout(() => {
    console.error("[shutdown] forced exit after 10s timeout.");
    process.exit(1);
  }, 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// =============================================================================
// Nightly sync — Monday.com → live.db (runs at midnight, live mode only)
// =============================================================================

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Guards against overlapping runs. The full pass takes hours, so without this a
 * frequent incremental would pile several syncs onto the same database. The
 * advisory lock inside the sync only warns; this is what actually prevents it.
 */
let syncInFlight: string | null = null;

/** Resolves true when the sync ran, false when skipped because one is in flight. */
function runSync(label: string, args: string[]): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (syncInFlight) {
      console.log(`[sync] ${label} skipped — a ${syncInFlight} sync is still running.`);
      resolve(false);
      return;
    }
    syncInFlight = label;
    console.log(`[sync] Starting ${label} sync from Monday.com…`);
    // `npm run sync:live -- <args>` — the `--` passes flags through to the script.
    const child = spawn("npm", ["run", "sync:live", "--", ...args], {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: process.env,
      shell: true,
    });
    child.on("close", (code) => {
      syncInFlight = null;
      if (code === 0) {
        console.log(`[sync] ${label} sync complete.`);
        resolve(true);
      } else {
        console.error(`[sync] ${label} sync failed (exit code ${code}).`);
        reject(new Error(`sync exited with code ${code}`));
      }
    });
    child.on("error", (err) => {
      syncInFlight = null;
      reject(err);
    });
  });
}

/**
 * Two schedules, because the sync has two very different costs.
 *
 *   INCREMENTAL (default 07:00–19:00, every 2h) — `--skip-timeline`.
 *     Fetches only board items whose Monday updated_at moved since the last run.
 *     Minutes, not hours (measured: 568s → 30s on a 753-item board). Keeps
 *     statuses, dates and assignments fresh through the working day.
 *
 *   FULL (default 01:00 daily) — `--full`.
 *     Walks every board and every timeline. This is the only pass that can
 *     detect deletions (an incremental pass never sees unchanged rows, so
 *     "missing" means nothing) and the only one that pulls Emails & Activities,
 *     because Monday does not move an item's updated_at when only its E&A
 *     timeline changes.
 *
 * Safe to leave unattended as of schema v15/v16: the sync upserts instead of
 * dropping, so an interrupted run leaves the previous data intact, a board that
 * fails keeps its rows, and a pre-sync snapshot is taken (and required) first.
 * That was NOT true before 2026-07-23 — see docs/nightly/2026-07-23.md.
 *
 * Off unless NIGHTLY_SYNC=on. Both cron expressions can be overridden.
 */
function scheduleNightlySync() {
  if (process.env.NIGHTLY_SYNC !== "on") {
    console.log(
      "[sync] Scheduled syncs DISABLED (set NIGHTLY_SYNC=on to enable). " +
        "Run manually: npm run sync:live [--full]",
    );
    return;
  }

  const fullCron = process.env.SYNC_FULL_CRON ?? "0 1 * * *";
  const incrementalCron = process.env.SYNC_INCREMENTAL_CRON ?? "0 7-19/2 * * *";

  cron.schedule(fullCron, () => {
    runSync("full", ["--full"]).catch((err) => console.error("[sync] Error:", err));
  });
  cron.schedule(incrementalCron, () => {
    runSync("incremental", ["--skip-timeline"]).catch((err) => console.error("[sync] Error:", err));
  });

  console.log(
    `[sync] Scheduled: full "${fullCron}" (deletions + emails/activities), ` +
      `incremental "${incrementalCron}" (columns only). Overlapping runs are skipped.`,
  );
}

function scheduleWalCheckpoint() {
  cron.schedule("0 * * * *", () => {
    // Skip while a sync holds the write lock. A TRUNCATE checkpoint needs an
    // exclusive lock and rewrites the main DB file; running it against a file the
    // sync process is actively writing was the leading suspect for the 2026-07-24
    // corruption. PASSIVE (below) already avoids the exclusive lock, but not
    // overlapping at all is cheaper and safer.
    if (syncInFlight) {
      console.log("[wal] checkpoint skipped — sync in flight.");
      return;
    }
    const held = (db.prepare("SELECT locked_by FROM sync_state WHERE id = 1").get() as
      | { locked_by: string | null }
      | undefined)?.locked_by;
    if (held) {
      console.log(`[wal] checkpoint skipped — sync lock held by ${held}.`);
      return;
    }
    try {
      // PASSIVE, not TRUNCATE: it never demands an exclusive lock and never
      // blocks — it flushes what it safely can and returns. SQLite's own
      // auto-checkpoint keeps the WAL from growing unbounded; this is a gentle
      // nudge, not a forced rewrite.
      db.pragma("wal_checkpoint(PASSIVE)");
      usersDb.pragma("wal_checkpoint(PASSIVE)");
    } catch (err) {
      console.error("[wal] checkpoint error:", err);
    }
  });
  console.log("[wal] Hourly WAL checkpoint scheduled (passive, skipped during sync).");
}

async function runBackup(): Promise<void> {
  const backupDir = path.join(DATA_DIR, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const key = backupEncryptionKey();

  // Refuse to start on a disk that cannot hold the result. Writing a partial
  // backup is worse than not writing one: on 2026-08-17 the encryption step ran
  // out of room mid-file, leaving a 1.5 GB PLAINTEXT copy of client data behind
  // (encryptFile only unlinks its source on success) and consuming the very
  // space the next attempt needed.
  const disk = readDisk(DATA_DIR);
  if (disk.level === "critical") {
    // Prune first — that is what frees the room — then let the caller retry on
    // the next tick rather than writing into a full filesystem.
    pruneBackups(backupDir);
    throw new Error(
      `Refusing to back up: only ${disk.freeGb?.toFixed(1) ?? "?"} GB free (${disk.usedPct ?? "?"}% used). ` +
        `Old backups were pruned; the next run will retry.`,
    );
  }

  try {
    // Back up the main client database, then encrypt at rest if a key is set.
    const dest = path.join(backupDir, `${DB_SOURCE}-${stamp}.db`);
    await db.backup(dest);
    const destFinal = key ? await encryptFile(dest, key) : dest;
    console.log(`[backup] wrote ${destFinal}`);

    // Back up users.db alongside — it holds roles, prefs, and Monday tokens.
    const usersDest = path.join(backupDir, `users-${stamp}.db`);
    await usersDb.backup(usersDest);
    const usersFinal = key ? await encryptFile(usersDest, key) : usersDest;
    console.log(`[backup] wrote ${usersFinal}`);

    if (!key) {
      console.warn("[backup] BACKUP_ENCRYPTION_KEY not set — backups written UNENCRYPTED.");
    }
  } finally {
    // Prune even when the write above failed. Retention used to be the last
    // statement in this function, so a failure — a full disk, most obviously —
    // skipped it entirely. That is a trap door: the one condition that makes
    // pruning urgent is the same one that prevented it, and the disk could
    // never recover on its own. It stayed full for a week.
    pruneBackups(backupDir);
  }
}

/**
 * Prune each backup series to BACKUP_KEEP, integrity-gated: a database that
 * fails its check does NOT prune, so a corrupt copy can never age out the last
 * known-good restore point (the 2026-07-24 lesson).
 */
function pruneBackups(backupDir: string): void {
  const KEEP = Number(process.env.BACKUP_KEEP) || 4;
  const series: Array<{ prefix: string; healthy: boolean }> = [
    { prefix: DB_SOURCE, healthy: isDatabaseHealthy(db) },
    { prefix: "users", healthy: isDatabaseHealthy(usersDb) },
  ];
  for (const { prefix, healthy } of series) {
    if (!healthy) {
      console.warn(`[backup] ${prefix}.db failed integrity — keeping all backups (no prune).`);
      continue;
    }
    // The pattern requires a DIGIT right after the prefix (the ISO year) so the
    // "live-" daily series never swallows the "live-presync-" safety snapshots.
    // `.enc` is optional because backups are encrypted after being written.
    const re = new RegExp(`^${prefix}-\\d.*\\.db(\\.enc)?$`);
    const files = fs
      .readdirSync(backupDir)
      .filter((f) => re.test(f) && !f.includes("premigrate"))
      .sort();
    for (const f of files.slice(0, Math.max(0, files.length - KEEP))) {
      try {
        fs.unlinkSync(path.join(backupDir, f));
        console.log(`[backup] pruned old backup: ${f}`);
      } catch (err) {
        console.warn(`[backup] could not prune ${f}:`, err);
      }
    }
  }
}

function scheduleBackups() {
  // Daily online backup at 05:30 — after the 01:00 full sync has settled. It
  // used to be 02:30, which now lands mid-sync: the online backup API would
  // still produce a consistent file, but of a half-synced database, which is a
  // poor thing to keep as the day's restore point.
  const backupCron = process.env.BACKUP_CRON ?? "30 5 * * *";
  cron.schedule(backupCron, () => {
    runBackup().catch((err) => console.error("[backup] error:", err));
  });
  console.log(`[backup] Daily backup scheduled — cron "${backupCron}".`);
}
