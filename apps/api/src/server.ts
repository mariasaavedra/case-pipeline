// =============================================================================
// Case Pipeline — Web Server
// =============================================================================

import type Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import cron from "node-cron";
import { initializeSchema, getSchemaVersion, SCHEMA_VERSION } from "@case-pipeline/seed/db/schema";
import { openDatabase, isDatabaseHealthy } from "@case-pipeline/seed/db/connection";
import { startWriteQueueProcessor } from "./write-queue/processor.js";
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
import { getAppointments, getDashboardKpis, getKpiCardDetail, getActiveCases, getSyncHealth, getArchivedRows, getCalendarEvents } from "@case-pipeline/query";
import type { Urgency, CalendarCategory } from "@case-pipeline/query";
import { setApiToken } from "@case-pipeline/monday";
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
import { initKpiColumns, resolveKpiColumns } from "./routes/kpi-columns.js";
import { initStatusOverrides, loadStatusOverrides } from "./routes/status-overrides.js";
import { initUrgencySettings, loadUrgencySettings } from "./routes/urgency-settings.js";
import { currentUserId } from "./db/user-context.js";
import { sanitizeKpiColumns } from "./db/users-types.js";
import { auditFromReq } from "./audit/log.js";
import { registerCallLogRoutes } from "./routes/call-log.js";
import { registerBoardItemWriteRoutes } from "./routes/board-item-write.js";
import { registerProfileWriteRoutes } from "./routes/profile-write.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { REPO_ROOT } from "./paths.js";
import { FIRM_TIMEZONE } from "./firm.js";
import { activeBoardKeys } from "./attorney-boards.js";
import { usersDb } from "./db/users-db.js";
import { backupEncryptionKey, encryptFile } from "./backup/crypto.js";
import { pruneBackupSeries, premigratePattern, PREMIGRATE_KEEP } from "./backup/prune.js";
import { diskLevel, readDisk } from "./backup/disk.js";
import { registerMondayOAuth, getUserMondayToken, markMondayTokenRejected } from "./routes/monday-oauth.js";
import { makeWriteTokenOptions } from "./write-token.js";
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

// Bound once to the shared token; see write-token.ts.
const writeTokenOptions = makeWriteTokenOptions(MONDAY_API_TOKEN);

console.log(`Database loaded (DB_SOURCE=${DB_SOURCE}): ${DB_PATH}`);

// =============================================================================
// Attorney Boards Config
// =============================================================================

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
// Profile write-back (notes, contracts, render) — see routes/profile-write.ts
// =============================================================================
registerProfileWriteRoutes(app, { db, mondayApiToken: MONDAY_API_TOKEN, writeTokenOptions });

// =============================================================================
// Board item write-back (status + columns) — see routes/board-item-write.ts
// =============================================================================
registerBoardItemWriteRoutes(app, { db, mondayApiToken: MONDAY_API_TOKEN, writeTokenOptions });

// =============================================================================
// Call Log — see routes/call-log.ts
// =============================================================================
registerCallLogRoutes(app, { db, mondayApiToken: MONDAY_API_TOKEN, writeTokenOptions });

// =============================================================================
// Settings (attorney boards, KPI columns, status overrides, urgency) —
// see routes/settings.ts
// =============================================================================
registerSettingsRoutes(app, db);

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
    scheduleConsultSweep();
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

/**
 * Consult folder sweep — the replacement for the Calendly→Zapier automation.
 *
 * For every Calendly consultation that has TAKEN PLACE and has no folder
 * recorded, records the folder that already exists or creates one in SCAL
 * Consults and records it. See docs/sharepoint-folders.md.
 *
 * Scheduled AFTER the incremental sync rather than on its own rhythm: it reads
 * candidates out of live.db, so running it on stale data just means it finds
 * nothing to do. (It cannot act on stale data wrongly — it re-reads the column
 * from Monday before writing — but there is no point burning API calls.)
 *
 * Off unless CONSULT_FOLDERS=on. Needs a signed-in Graph token on the host:
 *   npm run sharepoint:folders -- --login
 * Without one it exits non-zero with an instruction, which surfaces here rather
 * than failing silently.
 */
function scheduleConsultSweep() {
  if (process.env.CONSULT_FOLDERS !== "on") {
    console.log(
      "[consult] Folder sweep DISABLED (set CONSULT_FOLDERS=on to enable). " +
        "Run manually: npm run consult:sweep -- --apply",
    );
    return;
  }

  const sweepCron = process.env.CONSULT_SWEEP_CRON ?? "30 7-19/2 * * *";
  const days = process.env.CONSULT_SWEEP_DAYS ?? "45";

  // Scheduled in the firm's zone, not the container's. The default window is
  // written as working hours ("07:00–19:00"); read as UTC it would run
  // 02:30–14:30 Central, leaving an afternoon consult without its folder until
  // the small hours — the promptness this replaced Zapier to provide.
  cron.schedule(
    sweepCron,
    () => {
      if (syncInFlight) {
        console.log("[consult] Sweep skipped — a sync is running.");
        return;
      }
      runConsultSweep(days).catch((err) => console.error("[consult] Error:", err));
    },
    { timezone: FIRM_TIMEZONE },
  );

  console.log(
    `[consult] Folder sweep scheduled — cron "${sweepCron}" (${FIRM_TIMEZONE}), window ${days} days.`,
  );
}

/** Guards against overlapping sweeps, the way syncInFlight does for syncs. */
let sweepInFlight = false;

function runConsultSweep(days: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (sweepInFlight) {
      console.log("[consult] Sweep skipped — one is still running.");
      resolve();
      return;
    }
    sweepInFlight = true;
    const child = spawn("npm", ["run", "consult:sweep", "--", `--days=${days}`, "--apply"], {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: process.env,
      shell: true,
    });
    child.on("close", (code) => {
      sweepInFlight = false;
      if (code === 0) resolve();
      else reject(new Error(`consult sweep exited with code ${code}`));
    });
    child.on("error", (err) => {
      sweepInFlight = false;
      reject(err);
    });
  });
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
