// =============================================================================
// Workload Query Tests
// =============================================================================
// What matters: every page's open items land on the right person (by the
// roster's matcher, so two spellings are one person), an item counts once per
// person, and nothing assigned to nobody — or only to people who left — hides.

import { test, expect, describe } from "vitest";
import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { buildWorkload, collectWorkloadItems, getWorkload, type StaffResolver, type WorkloadItem } from "./workload";

function freshDb(): DatabaseInstance {
  const db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('test', 1, 'complete')").run();
  db.prepare("INSERT INTO profiles (batch_id, local_id, name, raw_column_values) VALUES (1, 'p1', 'Ana LOPEZ', '{}')").run();
  return db;
}

function insertForm(db: DatabaseInstance, localId: string, paralegals: string | null, attorney: string | null = null) {
  db.prepare(`INSERT INTO board_items
                (batch_id, local_id, monday_item_id, board_key, name, group_title, status, paralegals, attorney, profile_local_id, column_values)
              VALUES (1, ?, ?, '_cd_open_forms', ?, 'Open Forms', 'Needs Forms Appt', ?, ?, 'p1', '{}')`)
    .run(localId, `m-${localId}`, `I-130 ${localId}`, paralegals, attorney);
}

function insertFeeK(db: DatabaseInstance, localId: string, paralegal: string) {
  const cv = { paralegal: { label: paralegal }, ps_stage: { label: "Need Evidence" } };
  db.prepare(`INSERT INTO contracts (batch_id, local_id, monday_item_id, profile_local_id, name, group_title, raw_column_values)
              VALUES (1, ?, ?, 'p1', ?, 'Paid Fee Ks', ?)`).run(localId, `m-${localId}`, `Fee K ${localId}`, JSON.stringify(cv));
}

const roster: Record<string, { id: number; name: string; active: boolean }> = {
  "mayra ruiz": { id: 1, name: "Mayra Ruiz", active: true },
  "mayra r.": { id: 1, name: "Mayra Ruiz", active: true },
  "old paralegal": { id: 2, name: "Old Paralegal", active: false },
  "lucy betteridge": { id: 3, name: "Lucy Betteridge", active: true },
};
const resolve: StaffResolver = (n) => roster[n.trim().toLowerCase()] ?? null;

function item(over: Partial<WorkloadItem>): WorkloadItem {
  return {
    source: "open_forms", localId: "x", table: "board_items", boardKey: "_cd_open_forms", mondayItemId: "1",
    title: "I-130", clientName: null, clientLocalId: null, level: "ok", levelLabel: "Later", people: {}, ...over,
  };
}

describe("buildWorkload", () => {
  test("two spellings of one person are one row; an item counts once per person", () => {
    const r = buildWorkload(
      [
        item({ localId: "a", level: "critical", people: { paralegal: ["Mayra Ruiz"], attorney: ["Mayra R."] } }),
        item({ localId: "b", source: "foias", people: { paralegal: ["Mayra R."] } }),
      ],
      resolve,
    );
    expect(r.people).toHaveLength(1);
    const mayra = r.people[0]!;
    expect(mayra).toMatchObject({ staffId: 1, name: "Mayra Ruiz", total: 2, critical: 1 });
    expect(mayra.bySource).toMatchObject({ open_forms: 1, foias: 1 });
    expect(mayra.boardNames.sort()).toEqual(["Mayra R.", "Mayra Ruiz"]);
    expect(mayra.items[0]!.columns.sort()).toEqual(["attorney", "paralegal"]);
  });

  test("unmatched names still count, keyed by the name", () => {
    const r = buildWorkload([item({ people: { paralegal: ["New Hire"] } })], resolve);
    expect(r.people[0]).toMatchObject({ staffId: null, name: "New Hire", active: true, total: 1 });
  });

  test("lists unassigned work and work held only by inactive staff", () => {
    const r = buildWorkload(
      [
        item({ localId: "none", people: { attorney: ["Lucy Betteridge"] } }),
        item({ localId: "gone", people: { paralegal: ["Old Paralegal"] } }),
        item({ localId: "shared", people: { paralegal: ["Old Paralegal", "Mayra Ruiz"] } }),
        item({ localId: "fee", source: "contracts", table: "contracts", people: { assistant: ["Mayra Ruiz"] } }),
      ],
      resolve,
    );
    expect(r.unassigned.map((i) => i.localId)).toEqual(["none", "fee"]);
    expect(r.inactiveAssignee.map((i) => i.localId)).toEqual(["gone"]);
  });

  test("sorts people by critical, then total", () => {
    const r = buildWorkload(
      [
        item({ localId: "1", people: { paralegal: ["Mayra Ruiz"] } }),
        item({ localId: "2", people: { paralegal: ["Mayra Ruiz"] } }),
        item({ localId: "3", level: "critical", people: { attorney: ["Lucy Betteridge"] } }),
      ],
      resolve,
    );
    expect(r.people.map((p) => p.name)).toEqual(["Lucy Betteridge", "Mayra Ruiz"]);
  });
});

describe("collectWorkloadItems", () => {
  test("reads Open Forms and Paid Fee Ks with where each lives", () => {
    const db = freshDb();
    insertForm(db, "f1", "Mayra Ruiz, Old Paralegal", "Lucy Betteridge");
    insertForm(db, "f2", null);
    insertFeeK(db, "k1", "Mayra R.");
    const items = collectWorkloadItems(db, { today: "2026-10-16" });

    const form = items.find((i) => i.localId === "f1")!;
    expect(form).toMatchObject({ source: "open_forms", table: "board_items", boardKey: "_cd_open_forms", mondayItemId: "m-f1" });
    expect(form.people.paralegal).toEqual(["Mayra Ruiz", "Old Paralegal"]);
    const fee = items.find((i) => i.localId === "k1")!;
    expect(fee).toMatchObject({ source: "prescheduling", table: "contracts", boardKey: "fee_ks", mondayItemId: "m-k1" });

    const r = getWorkload(db, resolve, { today: "2026-10-16" });
    expect(r.people.find((p) => p.staffId === 1)?.total).toBe(2);
    expect(r.unassigned.map((i) => i.localId)).toContain("f2");
  });
});
