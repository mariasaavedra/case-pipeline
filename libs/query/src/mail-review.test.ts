// =============================================================================
// Mail Review Tests
// =============================================================================
// A saved scan's unsettled notices must reach Alerts, leave it once a person
// decides, and never let a decision point at the wrong client. Sample scans
// must not linger there.
// =============================================================================

import { test, expect, describe } from "vitest";
import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import { scanMailPages } from "./mail";
import {
  saveMailScan,
  getMailDocument,
  getMailReviewAlertGroup,
  countMailToReview,
  resolveMailDocument,
  applyFieldEdits,
  updateMailDocumentFields,
} from "./mail-review";
import { emptyFields } from "./mail";
import { getAlerts, getAlertsTotalCount } from "./alerts";

function freshDb(): DatabaseInstance {
  const db = new Database(":memory:");
  initializeSchema(db);
  db.prepare("INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('t', 1, 'complete')").run();
  const profile = db.prepare("INSERT INTO profiles (batch_id, local_id, name, a_number) VALUES (1, ?, ?, ?)");
  profile.run("p1", "Juan Lopez", "123456789");
  profile.run("p2", "Ana Ruiz", "987654321");
  const form = db.prepare(
    `INSERT INTO board_items (batch_id, local_id, board_key, name, status, profile_local_id, column_values)
     VALUES (1, ?, '_cd_open_forms', ?, 'Sent Out', ?, ?)`,
  );
  form.run("f1", "Juan I-130 (a)", "p1", JSON.stringify({ forms: { labels: ["I130"] } }));
  form.run("f2", "Juan I-130 (b)", "p1", JSON.stringify({ forms: { labels: ["I130"] } }));
  form.run("f3", "Ana N-400", "p2", JSON.stringify({ forms: { labels: ["N400"] } }));
  return db;
}

const PAGES = [
  // matched: Ana has exactly one N-400
  "Notice of Action Receipt Number: IOE0900000001 Form N-400 A# 987-654-321",
  // conflict: Juan has two empty I-130s
  "Notice of Action Receipt Number: IOE0900000002 Form I-130 A# 123-456-789",
  // no match
  "Notice of Action Receipt Number: IOE0900000003 A# 555-555-555",
];

const USER = { userId: 7, userName: "Front Desk" };

function scanAndSave(db: DatabaseInstance, isSample = false) {
  return saveMailScan(
    db,
    { fileName: "mail.pdf", pdfPath: null, isSample, uploadedBy: 7, uploadedByName: "Front Desk" },
    scanMailPages(db, PAGES),
  );
}

describe("saving and Alerts", () => {
  test("only unsettled notices reach Alerts; ids come back on the result", () => {
    const db = freshDb();
    const saved = scanAndSave(db);
    expect(saved.scanId).toBe(1);
    expect(saved.documents.map((d) => d.id)).toEqual([1, 2, 3]);
    expect(saved.documents.map((d) => d.needsReview)).toEqual([false, true, true]);

    const group = getMailReviewAlertGroup(db);
    expect(group).toMatchObject({ severity: "warning", label: "Mail to review", count: 2 });
    expect(group.items.map((i) => [i.mailDocumentId, i.status])).toEqual([
      [2, "Several Open Forms"],
      [3, "No match"],
    ]);
    expect(group.items[0]).toMatchObject({ clientName: "Juan Lopez", clientLocalId: "p1", sample: false });
  });

  test("the Alerts page and the Home count both include it", () => {
    const db = freshDb();
    scanAndSave(db);
    expect(getAlerts(db).groups.find((g) => g.label === "Mail to review")?.count).toBe(2);
    expect(getAlertsTotalCount(db)).toBe(2);
  });

  test("an attorney filter hides mail, which has no attorney", () => {
    const db = freshDb();
    scanAndSave(db);
    expect(getMailReviewAlertGroup(db, { attorney: "Someone" }).count).toBe(0);
  });

  test("sample scans show for a day, then drop out", () => {
    const db = freshDb();
    scanAndSave(db, true);
    expect(getMailReviewAlertGroup(db).items.every((i) => i.sample)).toBe(true);
    expect(countMailToReview(db)).toBe(2);
    db.prepare("UPDATE mail_scans SET uploaded_at = datetime('now', '-25 hours')").run();
    expect(countMailToReview(db)).toBe(0);
  });
});

describe("resolveMailDocument", () => {
  test("assigning to an Open Form takes its client and clears the alert", () => {
    const db = freshDb();
    scanAndSave(db);
    const r = resolveMailDocument(db, 2, { action: "assign", openFormLocalId: "f2" }, USER);
    expect(r.ok).toBe(true);
    const doc = getMailDocument(db, 2)!;
    expect(doc).toMatchObject({ reviewState: "assigned", resolvedByName: "Front Desk" });
    expect(doc.openForm?.localId).toBe("f2");
    expect(doc.profile?.localId).toBe("p1");
    expect(countMailToReview(db)).toBe(1);
  });

  test("a form belonging to another client is refused", () => {
    const db = freshDb();
    scanAndSave(db);
    const r = resolveMailDocument(db, 2, { action: "assign", openFormLocalId: "f3", profileLocalId: "p1" }, USER);
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(getMailDocument(db, 2)!.reviewState).toBe("open");
  });

  test("assign to a client alone when there is no form yet", () => {
    const db = freshDb();
    scanAndSave(db);
    const r = resolveMailDocument(db, 3, { action: "assign", profileLocalId: "p2" }, USER);
    expect(r.ok).toBe(true);
    expect(getMailDocument(db, 3)!.profile?.name).toBe("Ana Ruiz");
  });

  test("dismiss needs a reason", () => {
    const db = freshDb();
    scanAndSave(db);
    expect(resolveMailDocument(db, 3, { action: "dismiss" }, USER)).toMatchObject({ ok: false, status: 400 });
    const r = resolveMailDocument(db, 3, { action: "dismiss", note: "Junk mail" }, USER);
    expect(r.ok).toBe(true);
    expect(getMailDocument(db, 3)).toMatchObject({ reviewState: "dismissed", resolutionNote: "Junk mail" });
  });

  test("a second decision on the same notice is refused", () => {
    const db = freshDb();
    scanAndSave(db);
    resolveMailDocument(db, 3, { action: "dismiss", note: "Junk" }, USER);
    expect(resolveMailDocument(db, 3, { action: "assign", profileLocalId: "p2" }, USER)).toMatchObject({
      ok: false,
      status: 409,
    });
  });

  test("unknown document and nothing picked", () => {
    const db = freshDb();
    scanAndSave(db);
    expect(resolveMailDocument(db, 99, { action: "dismiss", note: "x" }, USER)).toMatchObject({ status: 404 });
    expect(resolveMailDocument(db, 2, { action: "assign" }, USER)).toMatchObject({ status: 400 });
  });
});

describe("correcting what was read", () => {
  test("applyFieldEdits normalizes what people type", () => {
    const r = applyFieldEdits(emptyFields(), {
      receiptNumbers: "ioe-0912345678, MSC2290000001",
      aNumbers: ["A 098-170-274"],
      caseType: "I-130 Petition for Alien Relative",
      receivedDate: "08/14/2026",
      beneficiary: "  LOPEZ,   JUAN ",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fields).toMatchObject({
      receiptNumbers: ["IOE0912345678", "MSC2290000001"],
      aNumbers: ["098170274"],
      formType: "I130",
      receivedDate: "2026-08-14",
      beneficiary: "LOPEZ, JUAN",
    });
    expect(r.fields.people).toEqual([{ role: "Beneficiary", name: "LOPEZ, JUAN" }]);
    expect(r.changed).toEqual(expect.arrayContaining(["receiptNumbers", "aNumbers", "caseType", "formType", "receivedDate", "beneficiary"]));
  });

  test("every bad field is reported, and nothing is applied", () => {
    const r = applyFieldEdits(emptyFields(), { receiptNumbers: "IOE123", aNumbers: "12", caseType: "Petition", noticeDate: "soon" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(["aNumbers", "caseType", "noticeDate", "receiptNumbers"]);
  });

  test("clearing a field is allowed", () => {
    const r = applyFieldEdits({ ...emptyFields(), priorityDate: "2026-01-01" }, { priorityDate: "" });
    expect(r.ok && r.fields.priorityDate).toBeNull();
  });

  test("a corrected A-number re-matches the notice; the original reading is kept", () => {
    const db = freshDb();
    scanAndSave(db); // doc 3 read A# 555-555-555 → no match
    const r = updateMailDocumentFields(db, 3, { aNumbers: "987654321" }, USER);
    expect(r.ok).toBe(true);
    const doc = getMailDocument(db, 3)!;
    expect(doc.fields.aNumbers).toEqual(["987654321"]);
    expect(doc.originalFields?.aNumbers).toEqual(["555555555"]);
    expect(doc).toMatchObject({ status: "matched", needsReview: false, fieldsEditedByName: "Front Desk" });
    expect(doc.profile?.localId).toBe("p2");
    expect(countMailToReview(db)).toBe(1);

    // A second edit keeps the FIRST reading as the original.
    updateMailDocumentFields(db, 3, { noticeType: "Receipt Notice" }, USER);
    expect(getMailDocument(db, 3)!.originalFields?.aNumbers).toEqual(["555555555"]);
  });

  test("no change is a no-op; settled notices can't be edited", () => {
    const db = freshDb();
    scanAndSave(db);
    const same = updateMailDocumentFields(db, 3, { aNumbers: "555-555-555" }, USER);
    expect(same).toMatchObject({ ok: true, changed: [] });
    expect(getMailDocument(db, 3)!.originalFields).toBeNull();

    resolveMailDocument(db, 3, { action: "dismiss", note: "junk" }, USER);
    expect(updateMailDocumentFields(db, 3, { aNumbers: "987654321" }, USER)).toMatchObject({ ok: false, status: 409 });
    expect(updateMailDocumentFields(db, 99, {}, USER)).toMatchObject({ ok: false, status: 404 });
  });
});
