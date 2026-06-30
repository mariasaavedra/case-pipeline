import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "@case-pipeline/seed/db/connection";

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const usersDb = openDatabase(path.join(DATA_DIR, "users.db"));
usersDb.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id                  INTEGER PRIMARY KEY,
    azure_oid           TEXT UNIQUE NOT NULL,
    email               TEXT NOT NULL,
    name                TEXT NOT NULL,
    role                TEXT NOT NULL DEFAULT 'user',
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    last_login          TEXT,
    monday_access_token TEXT,
    monday_name         TEXT
  )
`);

for (const col of ["monday_access_token", "monday_name"]) {
  const has = usersDb
    .prepare(`SELECT COUNT(*) AS cnt FROM pragma_table_info('users') WHERE name = ?`)
    .get(col) as { cnt: number };
  if (!has.cnt) usersDb.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT`);
}

export { usersDb };

export interface UserRow {
  id: number;
  azure_oid: string;
  email: string;
  name: string;
  role: "admin" | "user";
  created_at: string;
  last_login: string | null;
  monday_access_token: string | null;
  monday_name: string | null;
}
