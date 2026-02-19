// =============================================================================
// Case Pipeline — Web Server
// =============================================================================

import { Database } from "bun:sqlite";
import { validateSchema } from "./scripts/seed/lib/db/schema";
import {
  handleListClients,
  handleSearch,
  handleClientDetail,
  handleClientContracts,
  handleClientBoardItems,
  handleBoardItemDetail,
  handleClientUpdates,
  handleClientRelationships,
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
  development: {
    hmr: true,
    console: true,
  },
});

console.log(`Server running at http://localhost:${server.port}`);
