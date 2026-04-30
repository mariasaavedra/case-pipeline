// =============================================================================
// Case Pipeline — Web Server
// =============================================================================

import { Database } from "bun:sqlite";
import { validateSchema } from "./scripts/seed/lib/db/schema";
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
} from "./lib/api/handlers";
import homepage from "./web/index.html";

// =============================================================================
// Database
// =============================================================================

const DB_PATH = "data/seed.db";
const db = new Database(DB_PATH, { readonly: true });
validateSchema(db);

console.log(`Database loaded: ${DB_PATH}`);

// =============================================================================
// Server
// =============================================================================

const server = Bun.serve({
  port: 3000,
  routes: {
    "/": homepage,

    "/api/dashboard": {
      GET: (req) => handleDashboard(req, db),
    },
    "/api/appointments": {
      GET: (req) => handleAppointments(req, db),
    },
    "/api/alerts": {
      GET: (req) => handleAlerts(req, db),
    },
    "/api/search": {
      GET: (req) => handleTypedSearch(req, db),
    },
    "/api/filter-options": {
      GET: (req) => handleFilterOptions(req, db),
    },
    "/api/clients": {
      GET: (req) => handleListClients(req, db),
    },
    "/api/clients/search": {
      GET: (req) => handleSearch(req, db),
    },
    "/api/clients/:localId": {
      GET: (req) => handleClientDetail(req, db),
    },
    "/api/clients/:localId/contracts": {
      GET: (req) => handleClientContracts(req, db),
    },
    "/api/clients/:localId/board-items": {
      GET: (req) => handleClientBoardItems(req, db),
    },
    "/api/clients/:localId/updates": {
      GET: (req) => handleClientUpdates(req, db),
    },
    "/api/clients/:localId/relationships": {
      GET: (req) => handleClientRelationships(req, db),
    },
    "/api/board-items/:localId": {
      GET: (req) => handleBoardItemDetail(req, db),
    },
  },
  fetch(req) {
    const url = new URL(req.url);
    // Unmatched /api/ routes → 404 JSON
    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    // SPA catch-all: serve index.html for all other paths
    return new Response(Bun.file("web/index.html"));
  },
  development: {
    hmr: true,
    console: true,
  },
});

console.log(`Server running at http://localhost:${server.port}`);
