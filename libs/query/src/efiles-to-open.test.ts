// =============================================================================
// E-Files to open (P21) Tests
// =============================================================================

import { test, expect, describe } from "vitest";
import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import {
  getEFilesToOpen,
  normalizeCaseNo,
  normalizeStage,
  nextCaseNo,
  eFileFolderName,
  COURT_SUBFOLDERS,
  STANDARD_SUBFOLDERS,
} from "./efiles-to-open";

// =============================================================================
// Helpers
// =============================================================================

const TODAY = "2026-10-22";
const CONSULT = "https://sharmacrawford.sharepoint.com/sites/scalconsults/Shared%20Documents/2026%20Consults/D/DE%20LA%20O,%20Karla";

function freshDb(): DatabaseInstance {
  const db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('test', 1, 'complete')").run();
  return db;
}

function insertProfile(db: DatabaseInstance, localId: string, cv: Record<string, unknown>, extra: { address?: string; phone?: string; email?: string } = {}) {
  db.prepare(`INSERT INTO profiles (batch_id, local_id, name, address, phone, email, raw_column_values) VALUES (1, ?, ?, ?, ?, ?, ?)`).run(
    localId,
    `${cv.first_name ?? ""} ${cv.last_name ?? ""}`.trim() || localId,
    extra.address ?? null,
    extra.phone ?? null,
    extra.email ?? null,
    JSON.stringify(cv),
  );
}

interface FeeKOpts {
  localId: string;
  profile?: string;
  stage?: string;
  types?: string[];
  goesTo?: string | null;
  hireDate?: string;
  psStage?: string;
}

function insertFeeK(db: DatabaseInstance, o: FeeKOpts) {
  const cv = {
    contract_stage: { label: o.stage ?? "Paid needs action" },
    ...(o.types ? { fee_k_type: { labels: o.types } } : {}),
    ...(o.goesTo === null ? {} : { it_will_go_to: { label: o.goesTo ?? "Open Forms" } }),
    ...(o.hireDate ? { hire_date: { date: o.hireDate } } : {}),
    ...(o.psStage ? { ps_stage: { label: o.psStage } } : {}),
  };
  db.prepare(`
    INSERT INTO contracts (batch_id, local_id, profile_local_id, name, group_title, raw_column_values)
    VALUES (1, ?, ?, ?, 'Paid Fee Ks', ?)
  `).run(o.localId, o.profile ?? "p1", `Fee K ${o.localId}`, JSON.stringify(cv));
}

function insertFolder(db: DatabaseInstance, site: string, path: string, url: string, caseNo: string | null = null) {
  db.prepare(`INSERT INTO sp_folders (item_id, site, drive_id, name, path, web_url, case_no) VALUES (?, ?, 'd', ?, ?, ?, ?)`).run(
    `${site}:${path}`,
    site,
    path.split("/").pop(),
    path,
    url,
    caseNo,
  );
}

const karla = { first_name: "Karla", last_name: "De La O", consult_file: CONSULT };
const get = (db: DatabaseInstance) => getEFilesToOpen(db, { today: TODAY });
const byId = (db: DatabaseInstance) => Object.fromEntries(get(db).items.map((i) => [i.feeKLocalId, i]));

// =============================================================================
// Helpers' rules
// =============================================================================

describe("helpers", () => {
  test("case numbers in every typed form", () => {
    expect(normalizeCaseNo("26228")).toBe("26-228");
    expect(normalizeCaseNo("26-228")).toBe("26-228");
    expect(normalizeCaseNo(" 26 - 228 ")).toBe("26-228");
    expect(normalizeCaseNo("13--248")).toBe("13-248");
    expect(normalizeCaseNo("1243")).toBeNull();
    expect(normalizeCaseNo("")).toBeNull();
  });

  test("stage labels compare without case, spaces or hyphens", () => {
    expect(normalizeStage("Open E FILE")).toBe(normalizeStage("open e-file"));
    expect(normalizeStage("E-file OPENED")).toBe(normalizeStage("E-File opened"));
  });

  test("next number", () => {
    expect(nextCaseNo("26-230", "26")).toBe("26-231");
    expect(nextCaseNo("26-099", "26")).toBe("26-100");
    expect(nextCaseNo(null, "27")).toBe("27-001");
  });

  test("folder name", () => {
    expect(eFileFolderName("De La O", "Karla", "26-228")).toBe("DE LA O, Karla 26-228");
  });
});

// =============================================================================
// Queue
// =============================================================================

describe("getEFilesToOpen", () => {
  test("only Paid needs action and Open E FILE are in the queue", () => {
    const db = freshDb();
    insertProfile(db, "p1", karla);
    insertFeeK(db, { localId: "paid" });
    insertFeeK(db, { localId: "open", stage: "Open E-File" });
    insertFeeK(db, { localId: "done", stage: "E-file OPENED" });
    insertFeeK(db, { localId: "sent", stage: "Payment link sent" });
    expect(get(db).items.map((i) => i.feeKLocalId).sort()).toEqual(["open", "paid"]);
    db.close();
  });

  test("oldest hire first", () => {
    const db = freshDb();
    insertProfile(db, "p1", karla);
    insertFeeK(db, { localId: "new", hireDate: "2026-10-20" });
    insertFeeK(db, { localId: "old", hireDate: "2026-10-01" });
    insertFeeK(db, { localId: "nodate" });
    expect(get(db).items.map((i) => i.feeKLocalId)).toEqual(["old", "new", "nodate"]);
    db.close();
  });

  test("next case number: highest of profiles and E-File folders this year", () => {
    const db = freshDb();
    insertProfile(db, "p1", karla);
    insertProfile(db, "p2", { case_no: "26229" });
    insertProfile(db, "p3", { case_no: "25-400" });
    insertFolder(db, "scalefiles", "R/RIOS RODRIGUEZ, Jaime 26-230", "https://x/r", "26-230");
    insertFeeK(db, { localId: "k" });
    const r = get(db);
    expect(r.highestCaseNo).toEqual({ caseNo: "26-230", source: "e_file_folder" });
    expect(r.nextCaseNo).toBe("26-231");
    expect(r.items[0]!.plan.caseNo).toBe("26-231");
    db.close();
  });
});

// =============================================================================
// Paths + plan
// =============================================================================

describe("plan", () => {
  test("new E-File: folder, standard subfolders, consult copied then deleted, ledger row", () => {
    const db = freshDb();
    insertProfile(db, "p1", karla, { address: "1 Main St, KC MO", phone: "816-555-0100", email: "k@example.com" });
    insertFolder(db, "scalconsults", "2026 Consults/D/DE LA O, Karla", CONSULT);
    insertFeeK(db, { localId: "k", types: ["I-485 + I-130 - Full Packet"], hireDate: "2026-10-21" });
    const { plan, consultFolderPath } = byId(db).k!;
    expect(consultFolderPath).toBe("2026 Consults/D/DE LA O, Karla");
    expect(plan.path).toBe("efile");
    expect(plan.newFolderPath).toBe("D/DE LA O, Karla 26-001");
    expect(plan.subfolders).toEqual(STANDARD_SUBFOLDERS);
    expect(plan.deletesConsultFolder).toBe(true);
    expect(plan.consultFilesTo).toBe("Into CONSULT in the new E-File");
    expect(plan.ledgerTab).toBe("2026");
    expect(plan.ledgerRow).toEqual({
      caseNo: "26-001",
      name: "Karla DE LA O",
      dateOpened: "2026-10-21",
      caseType: "I-485 + I-130 - Full Packet",
      information: "1 Main St, KC MO · 816-555-0100 · k@example.com",
    });
    expect(plan.mondayChanges.map((c) => `${c.item} · ${c.column} → ${c.to}`)).toEqual([
      "Fee K · Contract Stage → E-file OPENED",
      "Fee K · PS Stage → Need to contact client",
      "Profile · E-File → Link to the new E-File",
      "Profile · Case No. → 26001",
      "Profile · Consult File → Link to the new E-File",
    ]);
    expect(plan.blockers).toEqual([]);
    db.close();
  });

  test("court: court folders added", () => {
    const db = freshDb();
    insertProfile(db, "p1", karla);
    insertFeeK(db, { localId: "k", goesTo: "Court Cases" });
    const { plan } = byId(db).k!;
    expect(plan.path).toBe("court");
    expect(plan.subfolders).toEqual([...STANDARD_SUBFOLDERS, ...COURT_SUBFOLDERS]);
    db.close();
  });

  test("Fee K Types table decides the board when the Fee K's own is empty", () => {
    const db = freshDb();
    insertProfile(db, "p1", karla);
    insertFeeK(db, { localId: "k", goesTo: null, types: ["Master Hearing"] });
    const r = getEFilesToOpen(db, { today: TODAY, boardForType: (t) => (t === "Master Hearing" ? "Court Cases" : undefined) });
    expect(r.items[0]!.plan.path).toBe("court");
    db.close();
  });

  test("FOIA: consult folder moves, no number, no ledger row, no E-File", () => {
    const db = freshDb();
    insertProfile(db, "p1", karla);
    insertFeeK(db, { localId: "k", types: ["FOIA (G639)"], goesTo: "FOIA requests" });
    const { plan } = byId(db).k!;
    expect(plan.path).toBe("foia");
    expect(plan.caseNo).toBeNull();
    expect(plan.newFolderPath).toBeNull();
    expect(plan.ledgerRow).toBeNull();
    expect(plan.deletesConsultFolder).toBe(false);
    expect(plan.consultFilesTo).toMatch(/FOIA/);
    expect(plan.mondayChanges.some((c) => c.column === "Case No.")).toBe(false);
    db.close();
  });

  test("FOIA without a consult folder is blocked", () => {
    const db = freshDb();
    insertProfile(db, "p1", { first_name: "Ana", last_name: "Lopez" });
    insertFeeK(db, { localId: "k", types: ["NRC FOIA"] });
    expect(byId(db).k!.plan.blockers).toContain("No consult folder on the profile to move to FOIA");
    db.close();
  });

  test("existing client by link: keeps number, consult files into their E-File, no ledger row", () => {
    const db = freshDb();
    insertProfile(db, "p1", { ...karla, e_file: "https://x/efile", case_no: "24150" });
    insertFeeK(db, { localId: "k", goesTo: "Court Cases" });
    const { plan } = byId(db).k!;
    expect(plan.path).toBe("existing");
    expect(plan.caseNo).toBe("24-150");
    expect(plan.caseNoIsNew).toBe(false);
    expect(plan.newFolderPath).toBeNull();
    expect(plan.subfolders).toEqual([]);
    expect(plan.ledgerRow).toBeNull();
    expect(plan.consultFilesTo).toBe("Into CONSULT in the client's E-File");
    expect(plan.deletesConsultFolder).toBe(true);
    db.close();
  });

  test("existing client by case number folder when the profile has no link", () => {
    const db = freshDb();
    insertProfile(db, "p1", { ...karla, case_no: "24-150" });
    insertFolder(db, "scalefiles", "D/DE LA O, Karla 24-150", "https://x/d", "24-150");
    insertFeeK(db, { localId: "k" });
    const { plan } = byId(db).k!;
    expect(plan.path).toBe("existing");
    expect(plan.pathReason).toMatch(/24-150/);
    db.close();
  });

  test("appointments that store the consult link get it replaced; others are left alone", () => {
    const db = freshDb();
    insertProfile(db, "p1", karla);
    const insert = db.prepare(`INSERT INTO board_items (batch_id, local_id, board_key, name, profile_local_id, column_values) VALUES (1, ?, ?, ?, 'p1', ?)`);
    insert.run("a1", "appointments_m", "Consult Oct 2", JSON.stringify({ consult_sharepoint: decodeURIComponent(CONSULT) }));
    insert.run("a2", "appointments_m", "Consult Sep 1", JSON.stringify({ consult_sharepoint: "https://elsewhere/other" }));
    insert.run("a3", "appointments_r", "No link", JSON.stringify({}));
    insertFeeK(db, { localId: "k" });
    const appt = byId(db).k!.plan.mondayChanges.filter((c) => c.item.startsWith("Appointment"));
    expect(appt.map((c) => c.item)).toEqual(["Appointment · Consult Oct 2"]);
    db.close();
  });

  test("missing names block a new E-File; a PS Stage already set is left alone", () => {
    const db = freshDb();
    insertProfile(db, "p1", { last_name: "Lopez" });
    insertFeeK(db, { localId: "k", psStage: "Need Evidence" });
    const { plan } = byId(db).k!;
    expect(plan.blockers).toContain("First Name and Last Name are needed on the profile to name the folder");
    expect(plan.mondayChanges.some((c) => c.column === "PS Stage")).toBe(false);
    db.close();
  });

  test("a type with nothing to collect skips Prescheduling: no PS Stage written", () => {
    const db = freshDb();
    insertProfile(db, "p1", karla);
    insertFeeK(db, { localId: "k", types: ["E33 - Address Change (c)"] });
    const items = getEFilesToOpen(db, { today: TODAY, prescheduling: (types) => !types.includes("E33 - Address Change (c)") }).items;
    expect(items[0]!.plan.prescheduling).toBe(false);
    expect(items[0]!.plan.mondayChanges.some((c) => c.column === "PS Stage")).toBe(false);
    expect(byId(db).k!.plan.prescheduling).toBe(true);
    db.close();
  });

  test("a Fee K with no profile is blocked", () => {
    const db = freshDb();
    insertFeeK(db, { localId: "k", profile: "nobody" });
    expect(byId(db).k!.plan.blockers[0]).toBe("The Fee K isn't connected to a profile");
    db.close();
  });
});
