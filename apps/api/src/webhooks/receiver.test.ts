// =============================================================================
// Webhook receiver tests (offline)
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { handleMondayWebhook } from "./receiver";

type DatabaseInstance = InstanceType<typeof Database>;

const SECRET = "test-webhook-secret";

function freshDb(): DatabaseInstance {
  const db = new Database(":memory:");
  initializeSchema(db);
  return db;
}

describe("handleMondayWebhook", () => {
  let db: DatabaseInstance;

  beforeEach(() => {
    process.env.MONDAY_WEBHOOK_SECRET = SECRET;
    db = freshDb();
  });

  afterEach(() => {
    delete process.env.MONDAY_WEBHOOK_SECRET;
    db.close();
  });

  it("returns 503 when the secret is not configured", () => {
    delete process.env.MONDAY_WEBHOOK_SECRET;
    const res = handleMondayWebhook(db, SECRET, { challenge: "abc" });
    expect(res.status).toBe(503);
  });

  it("rejects a wrong token with 401 and records nothing", () => {
    const res = handleMondayWebhook(db, "wrong-token", {
      event: { type: "create_item", boardId: 1, pulseId: 2 },
    });
    expect(res.status).toBe(401);
    const n = db.prepare("SELECT COUNT(*) AS n FROM webhook_events").get() as { n: number };
    expect(n.n).toBe(0);
  });

  it("echoes the registration challenge", () => {
    const res = handleMondayWebhook(db, SECRET, { challenge: "xyz-123" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ challenge: "xyz-123" });
  });

  it("persists a valid event to the inbox as pending", () => {
    const res = handleMondayWebhook(db, SECRET, {
      event: { type: "update_column_value", boardId: 111, pulseId: 222, columnId: "status" },
    });
    expect(res.status).toBe(200);
    const row = db
      .prepare("SELECT event_type, monday_board_id, monday_item_id, status, payload FROM webhook_events")
      .get() as { event_type: string; monday_board_id: string; monday_item_id: string; status: string; payload: string };
    expect(row.event_type).toBe("update_column_value");
    expect(row.monday_board_id).toBe("111");
    expect(row.monday_item_id).toBe("222");
    expect(row.status).toBe("pending");
    expect(JSON.parse(row.payload).event.columnId).toBe("status");
  });

  it("acknowledges but does not store a payload without event.type", () => {
    const res = handleMondayWebhook(db, SECRET, { something: "else" });
    expect(res.status).toBe(200);
    const n = db.prepare("SELECT COUNT(*) AS n FROM webhook_events").get() as { n: number };
    expect(n.n).toBe(0);
  });
});
