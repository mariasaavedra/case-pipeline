// =============================================================================
// Case Pipeline — Web Server
// =============================================================================

import { Database } from "bun:sqlite";
import { initializeSchema } from "./scripts/seed/lib/db/schema";
import {
  handleSearch,
  handleClientDetail,
  handleClientContracts,
  handleClientBoardItems,
  handleBoardItemDetail,
} from "./lib/api/handlers";
import homepage from "./web/index.html";

// =============================================================================
// Database
// =============================================================================

const DB_PATH = "data/seed.db";
const db = new Database(DB_PATH, { readonly: true });
initializeSchema(db);

console.log(`Database loaded: ${DB_PATH}`);

// =============================================================================
// Server
// =============================================================================

const server = Bun.serve({
  port: 3000,
  routes: {
    "/": homepage,

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
