import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const usersDb = new Database(path.join(DATA_DIR, "users.db"));
usersDb.pragma("journal_mode = WAL");
usersDb.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY,
    azure_oid   TEXT UNIQUE NOT NULL,
    email       TEXT NOT NULL,
    name        TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'user',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    last_login  TEXT
  )
`);

export { usersDb };

export interface UserRow {
  id: number;
  azure_oid: string;
  email: string;
  name: string;
  role: "admin" | "user";
  created_at: string;
  last_login: string | null;
}
