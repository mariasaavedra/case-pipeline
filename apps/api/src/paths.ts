// =============================================================================
// Repo-relative paths
// =============================================================================
// REPO_ROOT is derived from THIS file's location, so it stays correct no matter
// which module imports it — a copy of the expression in a file at a different
// nesting depth would silently resolve somewhere else.
// =============================================================================

import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root — apps/api/src/paths.ts → ../../.. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Where the SQLite databases, backups, and JSON config files live. */
export const DATA_DIR = path.join(REPO_ROOT, "data");
