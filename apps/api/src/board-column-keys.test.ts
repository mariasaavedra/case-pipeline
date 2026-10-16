import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import type { BoardConfig } from "@case-pipeline/config";
import type { BoardColumn } from "@case-pipeline/query";
import { applyColumnLocally, keysForColumn, resolveColumnKeys, shapeLocalValue } from "./board-column-keys.js";

const col = (columnId: string, title: string, type: string): BoardColumn => ({ columnId, title, type, options: [], position: 0 });

const config = {
  id: "1",
  name: "Calendaring",
  columns: {
    status: { resolve: "by_id", id: "color_1" },
    hearing_date: { resolve: "by_title", pattern: "^Hearing Date", types: ["date"] },
    note: { resolve: "by_type", type: "long_text" },
    gone: { resolve: "by_id", id: "deleted_col" },
    // A loose key that lands on the board's first date column, also named above.
    any_date: { resolve: "by_type", type: "date" },
  },
} as unknown as BoardConfig;

const columns = [col("color_1", "Status", "status"), col("date_9", "Hearing Date - Calendaring", "date"), col("long_2", "Quick note", "long_text")];

describe("resolveColumnKeys / keysForColumn", () => {
  it("resolves by id, title and type, like the sync; unresolved keys are left out", () => {
    const keys = resolveColumnKeys(config, columns);
    expect([...keys].map(([k, c]) => [k, c.columnId])).toEqual([["status", "color_1"], ["hearing_date", "date_9"], ["note", "long_2"], ["any_date", "date_9"]]);
  });

  it("every key a column is stored under, the most specific first", () => {
    expect(keysForColumn(config, columns, "date_9")).toEqual(["hearing_date", "any_date"]);
    expect(keysForColumn(config, columns, "not_mapped")).toEqual([]);
  });
});

describe("shapeLocalValue", () => {
  it("matches the sync's stored shapes", () => {
    expect(shapeLocalValue("status", "ATTENDED")).toEqual({ label: "ATTENDED" });
    expect(shapeLocalValue("dropdown", "EOIR")).toEqual({ labels: ["EOIR"] });
    expect(shapeLocalValue("date", "2026-10-16")).toEqual({ date: "2026-10-16" });
    expect(shapeLocalValue("long_text", "seen by IJ")).toBe("seen by IJ");
    expect(shapeLocalValue("date", "")).toBeNull();
  });
});

describe("applyColumnLocally", () => {
  let db: Database.Database;
  const row = () => db.prepare("SELECT status, column_values FROM board_items WHERE local_id = 'h1'").get() as { status: string | null; column_values: string };

  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
    db.prepare("INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('t', 1, 'complete')").run();
    db.prepare("INSERT INTO board_items (batch_id, local_id, board_key, name, status, column_values) VALUES (1, 'h1', 'calendaring', 'x', 'Added on Cal', ?)")
      .run(JSON.stringify({ status: { label: "Added on Cal" }, hearing_date: { date: "2026-09-30", time: "09:00:00" } }));
  });

  it("a status write also moves the row's status", () => {
    applyColumnLocally(db, "h1", "status", "status", "ATTENDED");
    expect(row().status).toBe("ATTENDED");
    expect(JSON.parse(row().column_values).status).toEqual({ label: "ATTENDED" });
  });

  it("sets a date, and an empty value removes the key", () => {
    applyColumnLocally(db, "h1", "hearing_date", "date", "2026-11-04");
    expect(JSON.parse(row().column_values).hearing_date).toEqual({ date: "2026-11-04" });
    applyColumnLocally(db, "h1", "hearing_date", "date", "");
    expect(JSON.parse(row().column_values)).not.toHaveProperty("hearing_date");
  });
});
