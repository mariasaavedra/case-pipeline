// =============================================================================
// Mail Intake Tests
// =============================================================================
// The weight is on the two decisions a person would otherwise make by hand:
// where one scanned notice ends and the next begins, and which Open Form a
// notice belongs to — including every way that can be ambiguous.
// =============================================================================

import { test, expect, describe } from "vitest";
import Database from "better-sqlite3";
type DatabaseInstance = InstanceType<typeof Database>;
import { initializeSchema } from "@case-pipeline/seed/db/schema";
import {
  extractNoticeFields,
  analyzePage,
  splitIntoDocuments,
  matchNotice,
  normalizeANumber,
  normalizeFormType,
  scanMailPages,
  repairOcrText,
} from "./mail";

function run(db: DatabaseInstance, sql: string, params: unknown[] = []): void {
  db.prepare(sql).run(...(params as unknown[] as never[]));
}

function freshDb(): DatabaseInstance {
  const db = new Database(":memory:");
  initializeSchema(db);
  run(db, "INSERT INTO seed_batches (batch_name, seed_value, status) VALUES ('test', 1, 'complete')");
  return db;
}

function insertProfile(db: DatabaseInstance, localId: string, name: string, aNumber: string | null): void {
  run(db, `INSERT INTO profiles (batch_id, local_id, name, a_number) VALUES (1, ?, ?, ?)`, [localId, name, aNumber]);
}

function insertOpenForm(
  db: DatabaseInstance,
  opts: { localId: string; profile: string; name: string; forms?: string; receipt?: string },
): void {
  const cv: Record<string, unknown> = {};
  if (opts.forms) cv.forms = { labels: [opts.forms] };
  if (opts.receipt) cv.receipt_no = opts.receipt;
  run(
    db,
    `INSERT INTO board_items (batch_id, local_id, board_key, name, status, profile_local_id, column_values)
     VALUES (1, ?, '_cd_open_forms', ?, 'Sent Out', ?, ?)`,
    [opts.localId, opts.name, opts.profile, JSON.stringify(cv)],
  );
}

const fields = (over: Partial<ReturnType<typeof extractNoticeFields>>) => ({
  receiptNumbers: [],
  aNumbers: [],
  formType: null,
  noticeType: null,
  noticeDate: null,
  people: [],
  ...over,
});

describe("extractNoticeFields", () => {
  const notice = [
    "Department of Homeland Security",
    "I-797C, Notice of Action",
    "Receipt Number: IOE0912345678 Case Type: I130 - Petition for Alien Relative",
    "Received Date: 08/14/2026 Notice Date: August 20, 2026",
    "Petitioner: MARIA LOPEZ",
    "Beneficiary: JUAN LOPEZ A# 123-456-789",
    "Notice Type: Receipt Notice",
  ].join("\n");

  test("reads every identifier off an I-797", () => {
    const f = extractNoticeFields(notice);
    expect(f.receiptNumbers).toEqual(["IOE0912345678"]);
    expect(f.aNumbers).toEqual(["123456789"]);
    expect(f.formType).toBe("I130"); // not I797
    expect(f.noticeType).toBe("Receipt Notice");
    expect(f.noticeDate).toBe("2026-08-20");
    expect(f.people).toEqual([
      { role: "Petitioner", name: "MARIA LOPEZ" },
      { role: "Beneficiary", name: "JUAN LOPEZ" },
    ]);
  });

  test("A-number spellings, and 8-digit numbers padded to 9", () => {
    expect(extractNoticeFields("Alien Number: 12 345 678").aNumbers).toEqual(["012345678"]);
    expect(extractNoticeFields("A-Number 098-170-274").aNumbers).toEqual(["098170274"]);
    expect(extractNoticeFields("A123456789").aNumbers).toEqual(["123456789"]);
  });

  test("a date after an A-number is not swallowed into it", () => {
    expect(extractNoticeFields("A# 123-456-789 2026").aNumbers).toEqual(["123456789"]);
  });

  test("a phone number is not an A-number", () => {
    expect(extractNoticeFields("Call 800-375-5283 for help").aNumbers).toEqual([]);
  });

  test("normalizers", () => {
    expect(normalizeANumber("A-12-345-678")).toBe("012345678");
    expect(normalizeANumber("1234")).toBeNull();
    expect(normalizeFormType("Jane - I-485 (Asylum)")).toBe("I485");
    expect(normalizeFormType("i-601a")).toBe("I601A");
    expect(normalizeFormType("Full Packet")).toBeNull();
  });
});

describe("repairOcrText", () => {
  test("receipt numbers: letters in the prefix, digits in the number", () => {
    expect(repairOcrText("Receipt Number: I0E09l2345S78")).toBe("Receipt Number: IOE0912345578");
    expect(repairOcrText("Receipt Number: MSC229OOO0001")).toBe("Receipt Number: MSC2290000001");
    expect(repairOcrText("Receipt Number: 1OE0912345678")).toBe("Receipt Number: IOE0912345678");
  });

  test("form numbers read as 1-130 become I-130, phone numbers are left alone", () => {
    expect(repairOcrText("Case Type: 1-130")).toBe("Case Type: I-130");
    expect(repairOcrText("Case Type: l-601A")).toBe("Case Type: I-601A");
    expect(repairOcrText("Call 1-800-375-5283")).toBe("Call 1-800-375-5283");
  });

  test("A-numbers after their label become digits", () => {
    expect(repairOcrText("A# 3O6-725-76l")).toBe("A# 306-725-761");
    expect(repairOcrText("Alien Number: S12 345 678")).toBe("Alien Number: 512 345 678");
  });

  test("ordinary words are never turned into numbers", () => {
    const prose = "Please bring this notice. Signed by ISABEL SOLIS on Monday.";
    expect(repairOcrText(prose)).toBe(prose);
  });

  test("only OCR'd pages are repaired", () => {
    expect(analyzePage(1, "Case Type: 1-130").fields.formType).toBeNull();
    const ocr = analyzePage(1, { text: "Case Type: 1-130", ocr: true, ocrConfidence: 88 });
    expect(ocr.fields.formType).toBe("I130");
    expect(ocr.ocrConfidence).toBe(88);
  });

  test("a document reports its OCR pages and lowest confidence", () => {
    const { documents } = splitIntoDocuments([
      analyzePage(1, { text: "Notice of Action A# 123-456-789 Page 1 of 2", ocr: true, ocrConfidence: 91 }),
      analyzePage(2, { text: "More of the same notice, Page 2 of 2", ocr: true, ocrConfidence: 64 }),
    ]);
    expect(documents[0]).toMatchObject({ ocrPages: [1, 2], ocrConfidence: 64 });
  });
});

describe("splitIntoDocuments", () => {
  const split = (texts: string[]) => splitIntoDocuments(texts.map((t, i) => analyzePage(i + 1, t)));

  test("'Page 2 of 2' stays with its notice even though it has no identifiers", () => {
    const { documents } = split([
      "Notice of Action Receipt Number: IOE0912345678 Page 1 of 2",
      "Please bring this notice to your appointment. Page 2 of 2",
    ]);
    expect(documents.map((d) => d.pages)).toEqual([[1, 2]]);
    expect(documents[0]!.uncertainPages).toEqual([]);
  });

  test("a new notice header starts a new document", () => {
    const { documents } = split([
      "Notice of Action Receipt Number: IOE0912345678",
      "Notice of Action Receipt Number: IOE0912345678 Approval Notice",
    ]);
    expect(documents.map((d) => [d.pages, d.splitReason])).toEqual([
      [[1], "first_page"],
      [[2], "notice_header"],
    ]);
  });

  test("different identifiers with no header still split", () => {
    const { documents } = split(["Receipt Number: IOE0912345678", "Receipt Number: MSC2290000001"]);
    expect(documents.map((d) => d.splitReason)).toEqual(["first_page", "new_identifiers"]);
  });

  test("a blank separator sheet splits and is dropped", () => {
    const { documents, separatorPages } = split(["A# 123-456-789 letter", "  \n ", "Dear client, a letter."]);
    expect(separatorPages).toEqual([2]);
    expect(documents.map((d) => [d.pages, d.splitReason])).toEqual([
      [[1], "first_page"],
      [[3], "after_separator"],
    ]);
  });

  test("a page with nothing to go on joins, flagged uncertain", () => {
    const { documents } = split(["A# 123-456-789 letter", "More text with no identifiers at all."]);
    expect(documents).toHaveLength(1);
    expect(documents[0]!.uncertainPages).toEqual([2]);
  });
});

describe("matchNotice", () => {
  test("new receipt: A-number → the one same-type Open Form with no receipt", () => {
    const db = freshDb();
    insertProfile(db, "p1", "Juan Lopez", "123-456-789");
    insertOpenForm(db, { localId: "f1", profile: "p1", name: "Juan Lopez", forms: "I130" });
    insertOpenForm(db, { localId: "f2", profile: "p1", name: "Juan Lopez", forms: "I765" });
    const m = matchNotice(db, fields({ receiptNumbers: ["IOE0912345678"], aNumbers: ["123456789"], formType: "I130" }));
    expect(m).toMatchObject({ status: "matched", matchedBy: "a_number", proposedAction: "fill_receipt" });
    expect(m.openForm?.localId).toBe("f1");
  });

  test("seed-style names carry the form type when there is no forms column", () => {
    const db = freshDb();
    insertProfile(db, "p1", "Juan Lopez", "123456789");
    insertOpenForm(db, { localId: "f1", profile: "p1", name: "Juan Lopez - I-485 (Asylum)" });
    const m = matchNotice(db, fields({ receiptNumbers: ["IOE0912345678"], aNumbers: ["123456789"], formType: "I485" }));
    expect(m.openForm?.localId).toBe("f1");
  });

  test("receipt on file wins, and needs no A-number", () => {
    const db = freshDb();
    insertProfile(db, "p1", "Juan Lopez", "123456789");
    insertOpenForm(db, { localId: "f1", profile: "p1", name: "Juan Lopez", forms: "I130", receipt: "IOE0912345678" });
    const m = matchNotice(db, fields({ receiptNumbers: ["IOE0912345678"] }));
    expect(m).toMatchObject({ status: "matched", matchedBy: "receipt_number", proposedAction: "attach_only" });
    expect(m.profile?.localId).toBe("p1");
  });

  test("receipt and A-number pointing at different clients", () => {
    const db = freshDb();
    insertProfile(db, "p1", "Juan Lopez", "123456789");
    insertProfile(db, "p2", "Ana Ruiz", "987654321");
    insertOpenForm(db, { localId: "f1", profile: "p1", name: "Juan", forms: "I130", receipt: "IOE0912345678" });
    const m = matchNotice(db, fields({ receiptNumbers: ["IOE0912345678"], aNumbers: ["987654321"] }));
    expect(m).toMatchObject({ status: "needs_attention", reason: "identifier_mismatch" });
  });

  test("two empty same-type forms → pick one", () => {
    const db = freshDb();
    insertProfile(db, "p1", "Juan Lopez", "123456789");
    insertOpenForm(db, { localId: "f1", profile: "p1", name: "Juan", forms: "I130" });
    insertOpenForm(db, { localId: "f2", profile: "p1", name: "Juan", forms: "I130" });
    const m = matchNotice(db, fields({ receiptNumbers: ["IOE0912345678"], aNumbers: ["123456789"], formType: "I130" }));
    expect(m).toMatchObject({ status: "needs_attention", reason: "several_forms" });
    expect(m.candidateForms.map((f) => f.localId)).toEqual(["f1", "f2"]);
  });

  test("the only same-type form already has a different receipt", () => {
    const db = freshDb();
    insertProfile(db, "p1", "Juan Lopez", "123456789");
    insertOpenForm(db, { localId: "f1", profile: "p1", name: "Juan", forms: "I130", receipt: "MSC2290000001" });
    const m = matchNotice(db, fields({ receiptNumbers: ["IOE0912345678"], aNumbers: ["123456789"], formType: "I130" }));
    expect(m).toMatchObject({ status: "needs_attention", reason: "receipt_already_filled" });
  });

  test("client found but no Open Form of that type", () => {
    const db = freshDb();
    insertProfile(db, "p1", "Juan Lopez", "123456789");
    insertOpenForm(db, { localId: "f1", profile: "p1", name: "Juan", forms: "I130" });
    const m = matchNotice(db, fields({ receiptNumbers: ["IOE0912345678"], aNumbers: ["123456789"], formType: "I765" }));
    expect(m).toMatchObject({ status: "needs_attention", reason: "no_open_form" });
    expect(m.profile?.localId).toBe("p1");
  });

  test("two clients sharing an A-number", () => {
    const db = freshDb();
    insertProfile(db, "p1", "Juan Lopez", "123456789");
    insertProfile(db, "p2", "Juan Lopez (dup)", "123-456-789");
    const m = matchNotice(db, fields({ aNumbers: ["123456789"] }));
    expect(m).toMatchObject({ status: "needs_attention", reason: "several_profiles" });
  });

  test("leading-zero A-numbers match either way they were typed", () => {
    const db = freshDb();
    insertProfile(db, "p1", "Juan Lopez", "98170274");
    insertOpenForm(db, { localId: "f1", profile: "p1", name: "Juan", forms: "N400" });
    const m = matchNotice(db, fields({ aNumbers: ["098170274"], formType: "N400" }));
    expect(m).toMatchObject({ status: "matched", proposedAction: "attach_only" });
  });

  test("unknown A-number and no identifiers at all", () => {
    const db = freshDb();
    expect(matchNotice(db, fields({ aNumbers: ["111111111"] })).status).toBe("no_match");
    expect(matchNotice(db, fields({})).status).toBe("unreadable");
  });

  test("scanMailPages counts each outcome", () => {
    const db = freshDb();
    insertProfile(db, "p1", "Juan Lopez", "123456789");
    insertOpenForm(db, { localId: "f1", profile: "p1", name: "Juan", forms: "I130" });
    const r = scanMailPages(db, [
      "Notice of Action Receipt Number: IOE0912345678 Form I-130 A# 123-456-789",
      "Notice of Action Receipt Number: IOE0999999999 A# 999-999-999",
      " ",
      "A handwritten letter.",
    ]);
    expect(r.summary).toEqual({ matched: 1, needs_attention: 0, no_match: 1, unreadable: 1 });
    expect(r.separatorPages).toEqual([3]);
  });
});
