// Fee K auto-fill: the POC name parser, the fill plan, and a run against an
// in-memory DB with a fake Monday. Names are invented; the shapes are the ones
// staff actually type into the Jail Intake POC column.

import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import {
  FEE_K_COLUMNS, findFeeKCandidates, parsePocName, planFeeKFill, runFeeKAutofill, stateFromMonday,
  type FeeKState, type ReadFeeK, type WriteFeeK,
} from "./fee-k-autofill";

describe("parsePocName", () => {
  it.each([
    ["Ana Torres - Wife", "Ana Torres"],
    ["Ana Torres- Sister in Law", "Ana Torres"],
    ["Ana Torres -Partner", "Ana Torres"],
    ["Luis RAMOS (Father)", "Luis RAMOS"],
    ["Luis RAMOS [WIFE]", "Luis RAMOS"],
    ["Luis RAMOS (Mother-in-Law)", "Luis RAMOS"],
    ["Luis RAMOS (friend/ex-romantic partner )", "Luis RAMOS"],
    ["Marco Antonio: Husband", "Marco Antonio"],
    ["Maria GOMEZ PEREZ, Wife", "Maria GOMEZ PEREZ"],
    ["Niece - Karen DIAZ", "Karen DIAZ"],
    ["Wife Veronica", "Veronica"],
    ["Brother Jefferson", "Jefferson"],
    ["Paula Sister", "Paula"],
    ["Mary Jimenez Wife", "Mary Jimenez"],
    ["Nancy Flores for Carlos R. ORTIZ 316-847-5430", "Nancy Flores"],
    ["Dekota Ben? for Kevin", "Dekota Ben"],
    ["Rosa Cruz Rojas", "Rosa Cruz Rojas"],
    ["Carla", "Carla"],
    ["Pat Ajayi- Family Friend", "Pat Ajayi"],
    ["Cammie Ruble - Director of community services KVC", "Cammie Ruble"],
    ["Ana Torres 913-555-0182", "Ana Torres"],
    ["Santa Clara Domingo Hernández- Wife", "Santa Clara Domingo Hernández"],
    ["Eduardo ABONZA-HERNANDEZ (brother)", "Eduardo ABONZA-HERNANDEZ"],
    ["Ana Paxtor-Matul - Sister", "Ana Paxtor-Matul"],
    ["Ana Torres-Wife", "Ana Torres"],
    ["Janet Connor – Wife", "Janet Connor"],
    ["Mom ---> Natalia MOREIRA", "Natalia MOREIRA"],
    ["sister ------- Esther", "Esther"],
    ["SIL  Kimberly LOPEZ", "Kimberly LOPEZ"],
    ["Angela LOPEZ (Boss)", "Angela LOPEZ"],
    ["Danny (Dan) HILL", "Danny HILL"],
    ["Rosa RAMIREZ (Partner (?))", "Rosa RAMIREZ"],
    ["Ryan Smith and Ida Jones (Cousin)", "Ryan Smith"],
    ["SON: Yhon Angel", "Yhon Angel"],
    ["Brother (Edgar Juarez)", "Edgar Juarez"],
    ["(Eva Samayo, Cousin)", "Eva Samayo"],
    ["Father Abe Aden | Rosa", "Abe Aden"],
  ])("%s → %s", (raw, name) => {
    expect(parsePocName(raw)).toBe(name);
  });

  it.each(["4173372836", "816-394-1891", "N/A", "Wife", "DAUGHTER", "Friend", "-", "Husband.", "(816) 745-7154", "", "  ", null, undefined])("%s → no name", (raw) => {
    expect(parsePocName(raw)).toBeNull();
  });
});

const empty: FeeKState = { af: null, ff: null, afSurcharge: null, ffSurcharge: null, paymentMethod: [], pocFullName: "" };
const CREDIT = "CREDIT Card - Surcharge Applies";

describe("planFeeKFill", () => {
  it("fills the POC name from the Jail Intake when the column is empty", () => {
    const fill = planFeeKFill(empty, "Ana Torres - Wife");
    expect(fill?.values).toEqual({ [FEE_K_COLUMNS.pocFullName]: "Ana Torres" });
    expect(fill?.local).toEqual({ poc_full_name_for_fee_ks: "Ana Torres" });
  });

  it("never overwrites a POC name someone typed", () => {
    expect(planFeeKFill({ ...empty, pocFullName: "Someone Else" }, "Ana Torres - Wife")).toBeNull();
  });

  it("leaves the POC blank when the intake has no name in it", () => {
    expect(planFeeKFill(empty, "4173372836")).toBeNull();
  });

  it("adds 3% surcharges only when paying by credit card", () => {
    const card = planFeeKFill({ ...empty, af: 3500, ff: 710, paymentMethod: [CREDIT] }, null);
    expect(card?.values).toEqual({ [FEE_K_COLUMNS.afSurcharge]: "105", [FEE_K_COLUMNS.ffSurcharge]: "21.3" });
    for (const pm of [["DEBIT Card"], ["Cash"], ["SPLIT PAYMENTS"], []]) {
      expect(planFeeKFill({ ...empty, af: 3500, ff: 710, paymentMethod: pm }, null)).toBeNull();
    }
  });

  it("keeps a surcharge already set (even 0), and skips a zero or missing fee", () => {
    expect(planFeeKFill({ ...empty, af: 850, afSurcharge: 0, paymentMethod: [CREDIT] }, null)).toBeNull();
    expect(planFeeKFill({ ...empty, af: 0, ff: null, paymentMethod: [CREDIT] }, null)).toBeNull();
    const onlyFf = planFeeKFill({ ...empty, af: 3000, afSurcharge: 90, ff: 555, paymentMethod: [CREDIT] }, null);
    expect(onlyFf?.values).toEqual({ [FEE_K_COLUMNS.ffSurcharge]: "16.65" });
  });
});

describe("stateFromMonday", () => {
  it("reads Monday's column texts", () => {
    expect(stateFromMonday({
      deal_value: "4000", numbers__1: "", numeric_mm0gfccq: "120", dropdown_mm7v5eeb: CREDIT, text_mm7xyv8e: " Ana ",
    })).toEqual({ af: 4000, ff: null, afSurcharge: 120, ffSurcharge: null, paymentMethod: [CREDIT], pocFullName: "Ana" });
  });
});

// ---------------------------------------------------------------------------

function setup() {
  const db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('t', 1, 'complete')").run();
  db.prepare("INSERT INTO profiles (batch_id, local_id, name) VALUES (1, 'p1', 'Juan Lopez')").run();
  db.prepare("INSERT INTO profiles (batch_id, local_id, name) VALUES (1, 'p2', 'Pedro Ruiz')").run();
  const item = db.prepare(
    `INSERT INTO board_items (batch_id, local_id, monday_item_id, board_key, name, profile_local_id, column_values, updated_at_source)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // Juan: an LB appointment linked to two intakes; the newer one has the POC.
  item.run("a1", "500", "appointments_lb", "Juan Lopez", "p1",
    JSON.stringify({ link_to_jail_intakes_1: { linked_item_ids: ["700", "701"] } }), null);
  item.run("j1", "700", "_fa_jail_intakes", "Juan Lopez", null,
    JSON.stringify({ poc_name_and_relationship_with_detained: "Old Contact (Friend)" }), "2026-09-01");
  item.run("j2", "701", "_fa_jail_intakes", "Juan Lopez", null,
    JSON.stringify({ poc_name_and_relationship_with_detained: "Ana Torres - Wife" }), "2026-10-10");
  const contract = db.prepare(
    `INSERT INTO contracts (batch_id, local_id, monday_item_id, profile_local_id, name, raw_column_values) VALUES (1, ?, ?, ?, ?, ?)`,
  );
  contract.run("c1", "900", "p1", "Juan Lopez — Bond", JSON.stringify({
    contract_added_on: { date: "2026-10-13" }, af: "3500", payment_method: { labels: [CREDIT] },
  }));
  // Pedro: not detained, cash — nothing to fill.
  contract.run("c2", "901", "p2", "Pedro Ruiz — I-130", JSON.stringify({
    contract_added_on: { date: "2026-10-13" }, af: "2000", payment_method: { labels: ["Cash"] },
  }));
  // Juan's older Fee K, from before the start date — never touched.
  contract.run("c3", "902", "p1", "Juan Lopez — Old", JSON.stringify({ contract_added_on: { date: "2026-08-01" } }));
  return db;
}

const local = (db: Database.Database, id: string) =>
  JSON.parse((db.prepare("SELECT raw_column_values r FROM contracts WHERE local_id = ?").get(id) as { r: string }).r) as Record<string, unknown>;

describe("findFeeKCandidates", () => {
  it("finds new Fee Ks with something to fill, via Profile → appointment → newest Jail Intake", () => {
    const c = findFeeKCandidates(setup(), "2026-10-01");
    expect(c.map((x) => x.mondayItemId)).toEqual(["900"]);
    expect(c[0]!.jailIntakePoc).toBe("Ana Torres - Wife");
    expect(c[0]!.fill.changes).toEqual(['POC Full Name = "Ana Torres"', "AF Surcharge = $105.00 (3% of $3500.00)"]);
  });
});

describe("runFeeKAutofill", () => {
  const monday = (text: Record<string, string>): ReadFeeK => async () => ({ boardId: "8025467270", text });

  it("dry run writes nothing", async () => {
    const db = setup();
    const writes: unknown[] = [];
    const r = await runFeeKAutofill({ db, since: "2026-10-01", apply: false, read: monday({}), write: async (...a) => { writes.push(a); } });
    expect(r.written).toHaveLength(1);
    expect(writes).toEqual([]);
    expect(local(db, "c1").poc_full_name_for_fee_ks).toBeUndefined();
  });

  it("re-plans on Monday's current values, writes once, and updates the local copy", async () => {
    const db = setup();
    const writes: [string, string, Record<string, string>][] = [];
    const write: WriteFeeK = async (b, i, v) => { writes.push([b, i, v]); };
    const read = monday({ deal_value: "3500", dropdown_mm7v5eeb: CREDIT });
    const r = await runFeeKAutofill({ db, since: "2026-10-01", apply: true, read, write });
    expect(writes).toEqual([["8025467270", "900", { text_mm7xyv8e: "Ana Torres", numeric_mm0gfccq: "105" }]]);
    expect(r.written).toHaveLength(1);
    expect(local(db, "c1")).toMatchObject({ poc_full_name_for_fee_ks: "Ana Torres", af_surcharge_fee: "105" });
    // The next run has nothing left to do.
    expect(findFeeKCandidates(db, "2026-10-01")).toEqual([]);
  });

  it("does not overwrite what someone filled on Monday since the last sync", async () => {
    const db = setup();
    const writes: unknown[] = [];
    const read = monday({ deal_value: "3500", dropdown_mm7v5eeb: CREDIT, numeric_mm0gfccq: "100", text_mm7xyv8e: "Ana T." });
    const r = await runFeeKAutofill({ db, since: "2026-10-01", apply: true, read, write: async (...a) => { writes.push(a); } });
    expect(writes).toEqual([]);
    expect(r.skipped[0]!.reason).toBe("already filled on Monday");
    expect(local(db, "c1")).toMatchObject({ poc_full_name_for_fee_ks: "Ana T.", af_surcharge_fee: "100" });
  });

  it("writes only the part still empty when Monday changed one of them", async () => {
    const db = setup();
    const writes: [string, string, Record<string, string>][] = [];
    // Payment method switched to debit on Monday: POC only.
    const read = monday({ deal_value: "3500", dropdown_mm7v5eeb: "DEBIT Card" });
    await runFeeKAutofill({ db, since: "2026-10-01", apply: true, read, write: async (b, i, v) => { writes.push([b, i, v]); } });
    expect(writes).toEqual([["8025467270", "900", { text_mm7xyv8e: "Ana Torres" }]]);
  });

  it("a failed write is reported and retried next run", async () => {
    const db = setup();
    const r = await runFeeKAutofill({
      db, since: "2026-10-01", apply: true, read: monday({ deal_value: "3500", dropdown_mm7v5eeb: CREDIT }),
      write: async () => { throw new Error("Monday is down"); },
    });
    expect(r.failed).toEqual([{ mondayItemId: "900", name: "Juan Lopez — Bond", error: "Monday is down" }]);
    expect(findFeeKCandidates(db, "2026-10-01")).toHaveLength(1);
  });
});
