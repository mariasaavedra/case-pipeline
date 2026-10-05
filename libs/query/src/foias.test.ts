// =============================================================================
// FOIAs Query Tests
// =============================================================================

import { test, expect, describe } from "vitest";
import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { getFoias, phaseOf, agenciesOf } from "./foias";

const TODAY = "2026-10-05";

function freshDb(): DatabaseInstance {
  const db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('test', 1, 'complete')").run();
  db.prepare("INSERT INTO profiles (batch_id, local_id, name) VALUES (1, 'p1', 'Ana LOPEZ')").run();
  return db;
}

function insertFoia(
  db: DatabaseInstance,
  localId: string,
  o: { status?: string; group?: string; profile?: string | null; paralegals?: string | null; since?: string; filed?: string; results?: string; inquiry?: string; quoted?: string[]; filedLabels?: string[]; deleted?: boolean },
) {
  const cv = {
    ...(o.since ? { on_foias_since: { date: o.since } } : {}),
    ...(o.filed ? { filed_on: { date: o.filed } } : {}),
    ...(o.results ? { results_received: { date: o.results } } : {}),
    ...(o.inquiry ? { inquiry_eligible: { date: o.inquiry } } : {}),
    ...(o.quoted ? { foias_quoted: { labels: o.quoted } } : {}),
    ...(o.filedLabels ? { foias_filed: { labels: o.filedLabels } } : {}),
    attorney: { label: "Lucy Betteridge" },
  };
  db.prepare(`
    INSERT INTO board_items (batch_id, local_id, board_key, group_title, name, status, paralegals, profile_local_id, column_values, deleted_at)
    VALUES (1, ?, 'foias', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    localId,
    o.group ?? "Pending FOIAs",
    `FOIA ${localId}`,
    o.status ?? null,
    o.paralegals === undefined ? "Mayra Ruiz" : o.paralegals,
    o.profile === undefined ? "p1" : o.profile,
    JSON.stringify(cv),
    o.deleted ? "2026-09-01" : null,
  );
}

const run = (db: DatabaseInstance) => getFoias(db, { today: TODAY });
const byId = (db: DatabaseInstance) => Object.fromEntries(run(db).items.map((i) => [i.localId, i]));

describe("phaseOf", () => {
  test("statuses map to the queue phases", () => {
    expect(phaseOf("Do we need it?")).toBe("decide");
    expect(phaseOf("TO-DO")).toBe("ours");
    expect(phaseOf("OTG To pay FF")).toBe("ours");
    expect(phaseOf("1 of 2 FOIAs filed")).toBe("ours");
    expect(phaseOf("Sent Out")).toBe("agency");
    expect(phaseOf("Filed")).toBe("agency");
    expect(phaseOf("INQUIRED")).toBe("agency");
    expect(phaseOf("Send to North Pole")).toBe("parked");
    expect(phaseOf(null)).toBe("ours");
  });
});

describe("agenciesOf", () => {
  test("normalises quoted and filed labels to agency names", () => {
    expect(agenciesOf(["EOIR FOIA", "OBIM/FBI FOIA", "USCIS"])).toEqual(["EOIR", "OBIM", "FBI", "USCIS"]);
    expect(agenciesOf(["FBI Filed", "DAR Filed"])).toEqual(["FBI", "DAR"]);
    expect(agenciesOf(["DARR", "FOIA"])).toEqual(["DAR"]);
  });
});

describe("getFoias", () => {
  test("done FOIAs leave the queue but are counted", () => {
    const db = freshDb();
    insertFoia(db, "open", { status: "TO-DO", since: "2026-09-30" });
    insertFoia(db, "completed", { status: "COMPLETED - RESULTS RECEIVED", results: "2026-09-20" });
    insertFoia(db, "dropped", { status: "NOT PROCEEDING" });
    insertFoia(db, "results-in", { status: "Sent Out", filed: "2026-01-01", results: "2026-02-01" });
    insertFoia(db, "done-group", { status: "Sent Out", group: "Done FOIAS", filed: "2025-01-01" });
    insertFoia(db, "deleted", { status: "TO-DO", deleted: true });
    const r = run(db);
    expect(r.items.map((i) => i.localId)).toEqual(["open"]);
    expect(r.doneCount).toBe(4);
    expect(r.doneLast30).toBe(1);
  });

  test("our turn ages from On FOIAs since; waiting ages from Filed On", () => {
    const db = freshDb();
    insertFoia(db, "ours", { status: "TO-DO", since: "2026-08-01", filed: "2026-10-01" });
    insertFoia(db, "agency", { status: "Sent Out", since: "2026-01-01", filed: "2026-09-20" });
    const i = byId(db);
    expect(i.ours).toMatchObject({ phase: "ours", ageDays: 65, ageLevel: "late" });
    expect(i.agency).toMatchObject({ phase: "agency", ageDays: 15, ageLevel: "fresh" });
  });

  test("agencies still to file = quoted minus filed", () => {
    const db = freshDb();
    insertFoia(db, "f", { status: "1 of 2 FOIAs filed", quoted: ["EOIR FOIA", "FBI"], filedLabels: ["EOIR Filed"] });
    expect(byId(db).f).toMatchObject({ quoted: ["EOIR", "FBI"], filed: ["EOIR"], toFile: ["FBI"] });
  });

  test("flags: inquiry due, stale, missing filed date / paralegal / profile", () => {
    const db = freshDb();
    insertFoia(db, "inq", { status: "Sent Out", filed: "2026-08-01", inquiry: "2026-10-01" });
    insertFoia(db, "inquired", { status: "INQUIRED", filed: "2026-08-01", inquiry: "2026-10-01" });
    insertFoia(db, "old", { status: "Sent Out", filed: "2025-01-01" });
    insertFoia(db, "nodate", { status: "Filed", paralegals: null, profile: null });
    const i = byId(db);
    expect(i.inq!.flags).toEqual(["inquiry_due"]);
    expect(i.inquired!.flags).toEqual([]);
    expect(i.old!.flags).toEqual(["stale"]);
    expect(i.nodate!.flags).toEqual(["no_filed_date", "no_paralegal", "no_profile"]);
  });

  test("sorted by phase, inquiry due first, then oldest", () => {
    const db = freshDb();
    insertFoia(db, "agency-old", { status: "Sent Out", filed: "2026-07-01" });
    insertFoia(db, "agency-inq", { status: "Sent Out", filed: "2026-09-25", inquiry: "2026-10-01" });
    insertFoia(db, "ours", { status: "TO-DO", since: "2026-10-01" });
    insertFoia(db, "decide", { status: "Do we need it?", since: "2026-10-01" });
    expect(run(db).items.map((i) => i.localId)).toEqual(["decide", "ours", "agency-inq", "agency-old"]);
  });
});
