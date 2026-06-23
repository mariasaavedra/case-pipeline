// =============================================================================
// Case Pipeline — Web Server
// =============================================================================

import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import cron from "node-cron";
import { validateSchema } from "@case-pipeline/seed/db/schema";
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
  handleDashboard,
  handleAppointments,
  handleActiveCases,
  handleAlerts,
} from "./handlers/handlers";
import { requireAuth } from "./auth/middleware.js";
import { handleAuthMe } from "./routes/auth.js";
import { handleAdminListUsers, handleAdminUpdateRole } from "./routes/admin.js";

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

const db = new Database(DB_PATH, { readonly: true });
validateSchema(db);

console.log(`Database loaded (DB_SOURCE=${DB_SOURCE}): ${DB_PATH}`);

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

// Admin
app.get("/api/admin/users", requireAuth, handleAdminListUsers);
app.patch("/api/admin/users/:id/role", requireAuth, handleAdminUpdateRole);

// Protect all remaining /api/* routes
app.use("/api/", requireAuth);

// API routes
app.get("/api/dashboard", adapt(handleDashboard));
app.get("/api/appointments", adapt(handleAppointments));
app.get("/api/active-cases", adapt(handleActiveCases));
app.get("/api/alerts", adapt(handleAlerts));
app.get("/api/search", adapt(handleTypedSearch));
app.get("/api/filter-options", adapt(handleFilterOptions));
app.get("/api/clients", adapt(handleListClients));
app.get("/api/clients/search", adapt(handleSearch));
app.get("/api/clients/:localId", adapt(handleClientDetail));
app.get("/api/clients/:localId/contracts", adapt(handleClientContracts));
app.get("/api/clients/:localId/board-items", adapt(handleClientBoardItems));
app.get("/api/clients/:localId/updates", adapt(handleClientUpdates));
app.get("/api/clients/:localId/relationships", adapt(handleClientRelationships));
app.get("/api/board-items/:localId", adapt(handleBoardItemDetail));

// Health check — cheap liveness/readiness probe for container orchestration.
// Confirms the DB handle is alive; intentionally outside /api so it is trivial
// to point a Docker HEALTHCHECK / load balancer at it.
app.get("/health", (_req, res) => {
  try {
    db.prepare("SELECT 1").get();
    res.status(200).json({ status: "ok", db: DB_SOURCE });
  } catch (err) {
    res.status(503).json({ status: "error", error: err instanceof Error ? err.message : String(err) });
  }
});

// Unknown /api/ routes → 404
app.use("/api/", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});


const PORT = Number(process.env.PORT ?? 3000);
// Bind to loopback by default. The API is unauthenticated and serves client
// PII, so locally it must not be reachable from other hosts. Inside a container
// (behind nginx, with no published port) set HOST=0.0.0.0 so the proxy can reach
// it on the compose network.
const HOST = process.env.HOST ?? "127.0.0.1";
app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);

  if (DB_SOURCE === "live") {
    scheduleNightlySync();
  }
});

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

function scheduleNightlySync() {
  // Runs every day at midnight (server local time).
  cron.schedule("0 0 * * *", () => {
    runSync().catch((err) => console.error("[sync] Error:", err));
  });
  console.log("[sync] Nightly sync scheduled — runs every day at midnight.");
}
