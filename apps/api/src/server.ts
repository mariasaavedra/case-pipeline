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
} from "./handlers/handlers";
import { getAppointments, getDashboardKpis, getKpiCardDetail, getActiveCases, getBoardStatusOptions, getBoardStatusOptionsFor, getBoardColumns, getBoardColumnsFor, getSyncHealth, getArchivedRows } from "@case-pipeline/query";
import type { Urgency } from "@case-pipeline/query";
import { setApiToken, fetchBoardStructure, fetchItem, resolveAllColumns } from "@case-pipeline/monday";
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
import { registerMondayOAuth, getUserMondayToken } from "./routes/monday-oauth.js";

// =============================================================================
// Database
// =============================================================================

// DB_SOURCE selects which local database the API reads from:
//   seed (default) → data/seed.db (Faker.js data, safe, used by CI)
//   live           → data/live.db (real Monday.com data, gitignored)
// Both share the same schema, query layer, and UI — only the data differs.
const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../data");
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
    // Prefer the posting user's personal Monday.com token; fall back to shared token
    const userToken = getUserMondayToken(req.user?.oid ?? "");
    const mondayUpdateId = await dataSource.postUpdate(profile.monday_item_id, text, userToken ?? undefined);
    insertUpdate(mondayUpdateId, "synced");
    auditFromReq(req, "monday.update_posted", {
      targetType: "profile",
      targetId: localId,
      metadata: { mondayItemId: profile.monday_item_id, mondayUpdateId, usedPersonalToken: !!userToken },
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

  const previous = item.status;
  const applyLocal = () =>
    db.prepare("UPDATE board_items SET status = ? WHERE local_id = ?").run(status, localId);

  try {
    const userToken = getUserMondayToken(req.user?.oid ?? "");
    await dataSource.setColumnValue(def.mondayBoardId, item.monday_item_id, def.statusColumnId, status, userToken ?? undefined);
    applyLocal();
    auditFromReq(req, "monday.status_changed", {
      targetType: "board_item",
      targetId: localId,
      metadata: {
        mondayItemId: item.monday_item_id, boardKey: item.board_key, columnId: def.statusColumnId,
        from: previous, to: status, usedPersonalToken: !!userToken,
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

  try {
    const userToken = getUserMondayToken(req.user?.oid ?? "");
    await dataSource.setColumnValue(schema.mondayBoardId, item.monday_item_id, columnId, value, userToken ?? undefined);
    auditFromReq(req, "monday.column_changed", {
      targetType: "board_item", targetId: localId,
      metadata: { mondayItemId: item.monday_item_id, boardKey: item.board_key, columnId, columnType: col.type, value, usedPersonalToken: !!userToken },
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
      targetType: "board_item", targetId: localId,
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
    const userToken = getUserMondayToken(req.user?.oid ?? "");
    const newId = await dataSource.createItem(schema.mondayBoardId, itemName, columnValues, userToken ?? undefined);
    auditFromReq(req, "monday.contract_created", {
      targetType: "profile", targetId: localId,
      metadata: { feeKItemId: newId, caseType, af, ff, pf, name: itemName, usedPersonalToken: !!userToken },
    });
    res.json({ data: { feeKItemId: newId, name: itemName, pending: false } });
  } catch (err) {
    console.error("[write-back] createItem failed; queueing for retry:", err);
    enqueueWrite(db, {
      opType: "create_item", targetTable: "profiles", targetLocalId: localId,
      mondayItemId: profile.monday_item_id, authorOid: req.user?.oid ?? null,
      payload: { boardId: schema.mondayBoardId, itemName, columnValues },
    });
    auditFromReq(req, "monday.contract_created", {
      targetType: "profile", targetId: localId,
      metadata: { caseType, af, ff, pf, name: itemName, queued: true },
    });
    res.status(202).json({ data: { name: itemName, pending: true } });
  }
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
    res.status(200).json({ status: "ok", db: DB_SOURCE, version: process.env.BUILD_SHA ?? "dev" });
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
      startWriteQueueProcessor(db, { token: MONDAY_API_TOKEN, resolveUserToken: getUserMondayToken });

      // Refresh board/column schema in the background so the editors work right
      // after a deploy without a manual data sync. Light (structure only) and
      // non-blocking; a failure leaves the last-good schema in place.
      refreshBoardSchema(db)
        .then((r) => console.log(`[schema-refresh] board schema refreshed: ${r.boards} boards${r.failed ? `, ${r.failed} failed` : ""}`))
        .catch((e) => console.error("[schema-refresh] failed:", e));
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

function runSync(label: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (syncInFlight) {
      console.log(`[sync] ${label} skipped — a ${syncInFlight} sync is still running.`);
      resolve();
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
        resolve();
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

  // Prune the daily series to the BACKUP_KEEP most recent (default 4). At
  // ~820 MB per live backup on a 24 GB disk, the old KEEP=14 (~11 GB) silently
  // filled the disk — which was the root cause of the 2026-07 corruptions
  // (a sync that runs out of room mid-write tears the file). See nightly 07-27.
  //
  // The pattern requires a DIGIT right after the prefix (the ISO year) so the
  // "live-" daily series never swallows the "live-presync-" safety snapshots,
  // and integrity-gates pruning: if a DB went corrupt after startup, its series
  // is NOT pruned, so a bad copy can't age out the last known-good backup.
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
    const re = new RegExp(`^${prefix}-\\d.*\\.db(\\.enc)?$`);
    const files = fs
      .readdirSync(backupDir)
      .filter((f) => re.test(f) && !f.includes("premigrate"))
      .sort();
    for (const f of files.slice(0, Math.max(0, files.length - KEEP))) {
      fs.unlinkSync(path.join(backupDir, f));
      console.log(`[backup] pruned old backup: ${f}`);
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
