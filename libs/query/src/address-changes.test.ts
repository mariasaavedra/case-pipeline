// =============================================================================
// Address Changes Query Tests
// =============================================================================

import { test, expect, describe } from "vitest";
import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { getAddressChanges, phaseOf, nextHearing } from "./address-changes";

const TODAY = "2026-10-02";

function freshDb(): DatabaseInstance {
  const db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('test', 1, 'complete')").run();
  db.prepare("INSERT INTO profiles (batch_id, local_id, name) VALUES (1, 'p1', 'Ana LOPEZ')").run();
  db.prepare("INSERT INTO profiles (batch_id, local_id, name) VALUES (1, 'p2', 'Luis PEREZ')").run();
  return db;
}

function insertChange(
  db: DatabaseInstance,
  localId: string,
  o: { status?: string; profile?: string | null; withWho?: string; received?: string; newAddy?: string; oldAddy?: string; assistant?: string; deleted?: boolean },
) {
  const cv = {
    ...(o.withWho ? { court_or_uscis: { label: o.withWho } } : {}),
    ...(o.received ? { date_received: { date: o.received } } : {}),
    ...(o.newAddy ? { new_addy: o.newAddy } : {}),
    ...(o.oldAddy ? { old_addy: o.oldAddy } : {}),
    ...(o.assistant ? { assistant: { label: o.assistant } } : {}),
  };
  db.prepare(`
    INSERT INTO board_items (batch_id, local_id, board_key, group_title, name, status, profile_local_id, column_values, deleted_at)
    VALUES (1, ?, 'address_changes', 'Address Changes', ?, ?, ?, ?, ?)
  `).run(localId, `Change ${localId}`, o.status ?? null, o.profile === undefined ? "p1" : o.profile, JSON.stringify(cv), o.deleted ? "2026-09-01" : null);
}

function insertCourtCase(db: DatabaseInstance, profile: string, hearing: string, group = "Court Case") {
  db.prepare(`
    INSERT INTO board_items (batch_id, local_id, board_key, group_title, name, profile_local_id, column_values)
    VALUES (1, ?, 'court_cases', ?, 'LB - case', ?, ?)
  `).run(`cc-${profile}-${hearing}`, group, profile, JSON.stringify({ hearing_date_calendaring: hearing, ecas_or_eservice: { label: "ECAS" } }));
}

const byId = (db: DatabaseInstance) => Object.fromEntries(getAddressChanges(db, { today: TODAY }).items.map((i) => [i.localId, i]));

describe("phaseOf", () => {
  test("statuses map to the queue phases", () => {
    expect(phaseOf("PAID - Needs Address Change")).toBe("firm");
    expect(phaseOf("Print and Send")).toBe("firm");
    expect(phaseOf("Form sent to client for signature")).toBe("review");
    expect(phaseOf("SENT FOR ATTY REVIEW")).toBe("review");
    expect(phaseOf("Submitted- waiting for approval")).toBe("submitted");
    expect(phaseOf("LOGGED - Needs Payment - Address Change")).toBe("payment");
    expect(phaseOf("Waiting for Payment")).toBe("payment");
    expect(phaseOf("ON HOLD")).toBe("hold");
    expect(phaseOf(null)).toBe("payment");
  });
});

describe("nextHearing", () => {
  test("first upcoming date from the mirror or the fallback", () => {
    expect(nextHearing("2026-08-01 10:00, 2026-11-24 11:30", null, TODAY)).toBe("2026-11-24");
    expect(nextHearing(null, "2026-10-20", TODAY)).toBe("2026-10-20");
    expect(nextHearing("2026-08-01 10:00", null, TODAY)).toBeNull();
  });
});

describe("getAddressChanges", () => {
  test("closed statuses and archived rows leave the queue", () => {
    const db = freshDb();
    insertChange(db, "open", { status: "PAID - Needs Address Change", received: "2026-09-30" });
    insertChange(db, "sent", { status: "Sent Out" });
    insertChange(db, "sent2", { status: "sent out" });
    insertChange(db, "nmf", { status: "Not Moving Forward" });
    insertChange(db, "gone", { status: "Waiting for Payment", deleted: true });
    expect(Object.keys(byId(db))).toEqual(["open"]);
  });

  test("ages from Date Received with tighter limits on our turn", () => {
    const db = freshDb();
    insertChange(db, "ours", { status: "PAID - Needs Address Change", received: "2026-09-20", withWho: "COURT", newAddy: "1 Main St" });
    insertChange(db, "unpaid", { status: "Waiting for Payment", received: "2026-09-20", withWho: "USCIS" });
    const ms = byId(db);
    expect(ms.ours!.ageDays).toBe(12);
    expect(ms.ours!.ageLevel).toBe("waiting");
    expect(ms.unpaid!.ageLevel).toBe("fresh");
  });

  test("court changes show the client's next hearing; USCIS-only don't", () => {
    const db = freshDb();
    insertCourtCase(db, "p1", "2026-10-20 09:00");
    insertCourtCase(db, "p2", "2026-10-15 09:00");
    insertCourtCase(db, "p2", "2026-10-03 09:00", "Withdrew");
    insertChange(db, "court", { status: "PAID - Needs Address Change", withWho: "BOTH - COURT & USCIS", received: "2026-09-30" });
    insertChange(db, "uscis", { status: "PAID - Needs Address Change", withWho: "USCIS", profile: "p2", received: "2026-09-30" });
    const ms = byId(db);
    expect(ms.court!.hearingDate).toBe("2026-10-20");
    expect(ms.court!.daysToHearing).toBe(18);
    expect(ms.court!.hearingSoon).toBe(true);
    expect(ms.court!.method).toBe("ECAS");
    expect(ms.uscis!.hearingDate).toBeNull();
    expect(ms.uscis!.court).toBe(false);
  });

  test("submitted changes aren't 'hearing soon'", () => {
    const db = freshDb();
    insertCourtCase(db, "p1", "2026-10-10 09:00");
    insertChange(db, "sub", { status: "Submitted- waiting for approval", withWho: "COURT", received: "2026-09-01" });
    expect(byId(db).sub!.hearingSoon).toBe(false);
  });

  test("cleanup flags", () => {
    const db = freshDb();
    insertChange(db, "stale", { status: "Waiting for Payment", received: "2025-01-01", withWho: "COURT" });
    insertChange(db, "bare", { status: "PAID - Needs Address Change", profile: null });
    const ms = byId(db);
    expect(ms.stale!.flags).toEqual(["stale_payment"]);
    expect(ms.bare!.flags).toEqual(["no_with_who", "no_new_address", "no_date_received", "no_profile"]);
  });

  test("order: our turn first, hearing soon then oldest within a phase", () => {
    const db = freshDb();
    insertCourtCase(db, "p2", "2026-10-10 09:00");
    insertChange(db, "pay", { status: "Waiting for Payment", received: "2025-12-01", withWho: "COURT" });
    insertChange(db, "old", { status: "PAID - Needs Address Change", received: "2026-07-01", withWho: "USCIS" });
    insertChange(db, "soon", { status: "PAID - Needs Address Change", received: "2026-09-30", withWho: "COURT", profile: "p2" });
    expect(getAddressChanges(db, { today: TODAY }).items.map((i) => i.localId)).toEqual(["soon", "old", "pay"]);
  });

  test("status options and write columns come from the synced board schema", () => {
    const db = freshDb();
    expect(getAddressChanges(db, { today: TODAY }).statusColumnId).toBeNull();
    db.prepare(`INSERT INTO board_columns (board_key, monday_board_id, column_id, title, type, options, position) VALUES
      ('address_changes', '1', 'status', 'Status - ONLY COMPLETE IF PAID', 'status', ?, 0),
      ('address_changes', '1', 'date__1', 'Date Sent', 'date', NULL, 1)`)
      .run(JSON.stringify([{ label: "Waiting for Payment" }, { label: "Sent Out" }]));
    const r = getAddressChanges(db, { today: TODAY });
    expect(r.statusColumnId).toBe("status");
    expect(r.dateSentColumnId).toBe("date__1");
    expect(r.statusOptions).toEqual(["Waiting for Payment", "Sent Out"]);
  });
});
