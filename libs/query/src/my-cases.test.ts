// =============================================================================
// My Cases (P6) Query Tests
// =============================================================================
// What matters: one paralegal's cases from both boards (or everyone's), the
// switcher's name list, North Pole snoozes hidden and counted, and the E-File
// link taken from the profile first, else the item's own mirror.

import { test, expect, describe } from "vitest";
import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { getMyCases } from "./my-cases";

const PROFILE_LINK = "https://firm.sharepoint.com/:f:/s/scalefiles/profile";
const MIRROR_LINK = "https://firm.sharepoint.com/:f:/s/scalefiles/mirror";

function freshDb(): DatabaseInstance {
  const db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('test', 1, 'complete')").run();
  db.prepare("INSERT INTO profiles (batch_id, local_id, name, raw_column_values) VALUES (1, 'p1', 'Ana LOPEZ', ?)")
    .run(JSON.stringify({ e_file: PROFILE_LINK }));
  db.prepare("INSERT INTO profiles (batch_id, local_id, name, raw_column_values) VALUES (1, 'p2', 'Luis PEREZ', '{}')").run();
  return db;
}

function insertFeeK(db: DatabaseInstance, localId: string, profile: string, paralegal: string, extra: Record<string, unknown> = {}) {
  const cv = { paralegal: { label: paralegal }, ps_stage: { label: "Need Evidence" }, e_file: MIRROR_LINK, ...extra };
  db.prepare(`INSERT INTO contracts (batch_id, local_id, profile_local_id, name, group_title, raw_column_values)
              VALUES (1, ?, ?, ?, 'Paid Fee Ks', ?)`).run(localId, profile, `Fee K ${localId}`, JSON.stringify(cv));
}

function insertForm(db: DatabaseInstance, localId: string, profile: string, paralegals: string, extra: { status?: string; cv?: Record<string, unknown> } = {}) {
  const cv = { e_file: `${MIRROR_LINK}, https://firm.sharepoint.com/other`, forms_appt_date: { date: "2026-10-20" }, ...extra.cv };
  db.prepare(`INSERT INTO board_items
                (batch_id, local_id, monday_item_id, board_key, name, group_title, status, paralegals, profile_local_id, column_values)
              VALUES (1, ?, ?, '_cd_open_forms', ?, 'Open Forms', ?, ?, ?, ?)`)
    .run(localId, `m-${localId}`, `I-130 ${localId}`, extra.status ?? "Needs Forms Appt", paralegals, profile, JSON.stringify(cv));
}

describe("getMyCases", () => {
  test("one paralegal's cases from both boards; everyone's with null", () => {
    const db = freshDb();
    insertFeeK(db, "fk1", "p1", "Laura Torres");
    insertFeeK(db, "fk2", "p2", "Paola Barbosa, Laura Torres");
    insertFeeK(db, "fk3", "p2", "Walter Taborda");
    insertForm(db, "of1", "p1", "laura torres");
    insertForm(db, "of2", "p2", "Mayra Ruiz");

    const mine = getMyCases(db, { paralegal: "Laura Torres" });
    expect(mine.prescheduling.map((c) => c.localId).sort()).toEqual(["fk1", "fk2"]);
    expect(mine.openForms.map((c) => c.localId)).toEqual(["of1"]);
    expect(mine.paralegals).toEqual(["Laura Torres", "Mayra Ruiz", "Paola Barbosa", "Walter Taborda"]);

    const all = getMyCases(db, { paralegal: null });
    expect(all.prescheduling).toHaveLength(3);
    expect(all.openForms).toHaveLength(2);
    db.close();
  });

  test("E-File: the profile's link first, else the item's mirror (first link only)", () => {
    const db = freshDb();
    insertFeeK(db, "fk1", "p1", "Laura Torres");
    insertFeeK(db, "fk2", "p2", "Laura Torres");
    insertForm(db, "of2", "p2", "Laura Torres");
    const r = getMyCases(db, { paralegal: "Laura Torres" });
    const fee = Object.fromEntries(r.prescheduling.map((c) => [c.localId, c]));
    expect(fee.fk1).toMatchObject({ eFile: PROFILE_LINK, eFileOnProfile: true });
    expect(fee.fk2).toMatchObject({ eFile: MIRROR_LINK, eFileOnProfile: false });
    expect(r.openForms[0]).toMatchObject({ eFile: MIRROR_LINK, eFileOnProfile: false, mondayItemId: "m-of2", formsApptDate: "2026-10-20" });
    db.close();
  });

  test("North Pole cases with a future return date are hidden and counted", () => {
    const db = freshDb();
    insertFeeK(db, "fk1", "p1", "Laura Torres", { ps_stage: { label: "Send to North Pole" }, north_pole_until: { date: "2999-01-01" } });
    insertForm(db, "of1", "p1", "Laura Torres", { status: "Send to North Pole", cv: { north_pole_until: { date: "2999-01-01" } } });
    insertForm(db, "of2", "p1", "Laura Torres");
    const r = getMyCases(db, { paralegal: "Laura Torres" });
    expect(r.prescheduling).toHaveLength(0);
    expect(r.openForms.map((c) => c.localId)).toEqual(["of2"]);
    expect(r.snoozedCount).toBe(2);
    expect(getMyCases(db, { paralegal: "Laura Torres", includeSnoozed: true }).openForms).toHaveLength(2);
    db.close();
  });
});
