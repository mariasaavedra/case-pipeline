// Test helper: an in-memory users.db with just what the roster reads.
import Database from "better-sqlite3";
import { createStaffTablesSql } from "./schema.js";

export function makeRosterDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY, azure_oid TEXT UNIQUE NOT NULL, email TEXT NOT NULL, name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1, monday_name TEXT, paralegal_link TEXT, attorney_board TEXT, staff_id INTEGER
  )`);
  db.exec(createStaffTablesSql);
  return db;
}
