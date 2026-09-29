import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { resolveAuditTargets } from "./audit-targets";

function db() {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE profiles (local_id TEXT, monday_item_id TEXT, name TEXT);
    CREATE TABLE board_items (local_id TEXT, monday_item_id TEXT, board_key TEXT, name TEXT, profile_local_id TEXT);
    INSERT INTO profiles VALUES ('p1', '100', 'Ana Ruiz');
    INSERT INTO board_items VALUES ('b1', '200', 'open_forms', 'I-130', 'p1');
    INSERT INTO board_items VALUES ('b2', '300', 'contracts', 'Orphan K', NULL);
    INSERT INTO board_items VALUES ('b3', '400', 'open_forms', 'Ana Ruiz - I-485', 'p1');
  `);
  return d;
}

describe("resolveAuditTargets", () => {
  it("resolves profiles, board items (with their client) and skips unknown ids", () => {
    const m = resolveAuditTargets(db(), ["100", "200", "300", "999", "100"]);
    expect(m.get("100")).toEqual({ name: "Ana Ruiz", boardKey: null, profileLocalId: "p1" });
    expect(m.get("200")).toEqual({ name: "Ana Ruiz · I-130", boardKey: "open_forms", profileLocalId: "p1" });
    expect(m.get("300")).toEqual({ name: "Orphan K", boardKey: "contracts", profileLocalId: null });
    expect(m.has("999")).toBe(false);
  });

  it("doesn't repeat the client when the item name already starts with it", () => {
    expect(resolveAuditTargets(db(), ["400"]).get("400")?.name).toBe("Ana Ruiz - I-485");
  });

  it("returns an empty map without querying when there are no ids", () => {
    expect(resolveAuditTargets(db(), []).size).toBe(0);
  });
});
