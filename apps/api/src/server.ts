// =============================================================================
// Case Pipeline — Web Server
// =============================================================================

import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  handleAlerts,
} from "./handlers/handlers";

// =============================================================================
// Database
// =============================================================================

const DB_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../data/seed.db");
const db = new Database(DB_PATH, { readonly: true });
validateSchema(db);

console.log(`Database loaded: ${DB_PATH}`);

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
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.join(__dirname, "../../web/dist");

// API routes
app.get("/api/dashboard", adapt(handleDashboard));
app.get("/api/appointments", adapt(handleAppointments));
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

// Unknown /api/ routes → 404
app.use("/api/", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Static web assets (built frontend)
app.use(express.static(webDir));

// SPA catch-all
app.get("/*path", (_req, res) => {
  res.sendFile(path.join(webDir, "index.html"));
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Note: frontend requires a separate Vite build (added in Phase 3)`);
});
