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
import { openDatabase } from "@case-pipeline/seed/db/connection";
import { startWriteQueueProcessor, enqueueWrite } from "./write-queue/processor.js";
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
  handleActiveCases,
  handleAlerts,
} from "./handlers/handlers";
import { getAppointments, getDashboardKpis, getKpiCardDetail } from "@case-pipeline/query";
import { setApiToken, createUpdate, fetchBoardStructure, fetchItem, resolveAllColumns } from "@case-pipeline/monday";
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

const db = openDatabase(DB_PATH);

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

app.get("/api/active-cases", adapt(handleActiveCases));
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
    replyToUpdateId: null,
    createdAtSource: now,
    pending,
  });

  try {
    // Prefer the posting user's personal Monday.com token; fall back to shared token
    const userToken = getUserMondayToken(req.user?.oid ?? "");
    const mondayUpdateId = await createUpdate(profile.monday_item_id, text, userToken ?? undefined);
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

// Health check — cheap liveness/readiness probe for container orchestration.
// Confirms the DB handle is alive; intentionally outside /api so it is trivial
// to point a Docker HEALTHCHECK / load balancer at it.
app.get("/health", (_req, res) => {
  try {
    db.prepare("SELECT 1").get();
    res.status(200).json({ status: "ok", db: DB_SOURCE });
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

function runSync(): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log("[sync] Starting nightly sync from Monday.com…");
    const child = spawn("npm", ["run", "sync:live"], {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: process.env,
      shell: true,
    });
    child.on("close", (code) => {
      if (code === 0) {
        console.log("[sync] Nightly sync complete.");
        resolve();
      } else {
        console.error(`[sync] Nightly sync failed (exit code ${code}).`);
        reject(new Error(`sync exited with code ${code}`));
      }
    });
    child.on("error", reject);
  });
}

/**
 * DISABLED BY DEFAULT — opt in with NIGHTLY_SYNC=on.
 *
 * `npm run sync:live` opens with resetDatabase() (a full DROP) BEFORE it fetches
 * anything, so a run that dies partway leaves an empty database rather than the
 * previous night's data. That is not a theoretical risk: the 2026-07-16 run died
 * mid-pass and left client_updates empty for a week, and the 2026-07-23 run lost
 * the whole _cd_open_forms board to a network timeout — the board behind the
 * Open Forms card, Active Cases and My Cases.
 *
 * Leaving a destructive-first, 3-hour job on an unattended midnight timer means
 * betting the entire dataset on a clean network run every night. Off until the
 * sync is incremental (upsert by monday_item_id) instead of drop-and-rebuild.
 */
function scheduleNightlySync() {
  if (process.env.NIGHTLY_SYNC !== "on") {
    console.log(
      "[sync] Nightly sync DISABLED (set NIGHTLY_SYNC=on to enable). " +
        "Full sync is destructive-first — run it manually: npm run sync:live",
    );
    return;
  }
  // Runs every day at midnight (server local time).
  cron.schedule("0 0 * * *", () => {
    runSync().catch((err) => console.error("[sync] Error:", err));
  });
  console.log("[sync] Nightly sync scheduled — runs every day at midnight.");
}

function scheduleWalCheckpoint() {
  cron.schedule("0 * * * *", () => {
    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
      usersDb.pragma("wal_checkpoint(TRUNCATE)");
    } catch (err) {
      console.error("[wal] checkpoint error:", err);
    }
  });
  console.log("[wal] Hourly WAL checkpoint scheduled.");
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

  // Prune daily backups to the 14 most recent per prefix. Matches both plain
  // (.db) and encrypted (.db.enc) outputs. Pre-migration snapshots
  // (…-premigrate-…) are kept separately and never pruned here.
  const KEEP = 14;
  for (const prefix of [DB_SOURCE, "users"]) {
    const files = fs
      .readdirSync(backupDir)
      .filter(
        (f) =>
          f.startsWith(`${prefix}-`) &&
          (f.endsWith(".db") || f.endsWith(".db.enc")) &&
          !f.includes("premigrate"),
      )
      .sort();
    for (const f of files.slice(0, Math.max(0, files.length - KEEP))) {
      fs.unlinkSync(path.join(backupDir, f));
      console.log(`[backup] pruned old backup: ${f}`);
    }
  }
}

function scheduleBackups() {
  // Daily online backup at 02:30 (after the midnight sync settles).
  cron.schedule("30 2 * * *", () => {
    runBackup().catch((err) => console.error("[backup] error:", err));
  });
  console.log("[backup] Daily backup scheduled — runs at 02:30.");
}
