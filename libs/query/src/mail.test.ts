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
  emptyFields,
  compareNames,
  nameTokens,
  normalizeFields,
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
  opts: { localId: string; profile: string; name: string; forms?: string; receipt?: string; received?: string },
): void {
  const cv: Record<string, unknown> = {};
  if (opts.forms) cv.forms = { labels: [opts.forms] };
  if (opts.receipt) cv.receipt_no = opts.receipt;
  if (opts.received) cv.received_priority_date = { date: opts.received };
  run(
    db,
    `INSERT INTO board_items (batch_id, local_id, board_key, name, status, profile_local_id, column_values)
     VALUES (1, ?, '_cd_open_forms', ?, 'Sent Out', ?, ?)`,
    [opts.localId, opts.name, opts.profile, JSON.stringify(cv)],
  );
}

const fields = (over: Partial<ReturnType<typeof extractNoticeFields>>) => ({ ...emptyFields(), ...over });

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
    // Two of three prefix letters misread — trusted only because IOE is a real prefix (seen on real scans).
    expect(repairOcrText("10E0929554021 1485 - APPLICATION")).toBe("IOE0929554021 1485 - APPLICATION");
    expect(repairOcrText("RECEIPT # |0E9319415852")).toBe("RECEIPT # IOE9319415852");
    expect(repairOcrText("phone 100 1234567890")).toBe("phone 100 1234567890");
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

  test("a document reports its OCR pages and the lowest confidence among its notice pages", () => {
    const { documents } = splitIntoDocuments([
      analyzePage(1, { text: "Notice of Action A# 123-456-789 Page 1 of 3", ocr: true, ocrConfidence: 91 }),
      analyzePage(2, { text: "Notice Date: 09/01/2026 Page 2 of 3", ocr: true, ocrConfidence: 64 }),
      // A smudged envelope says nothing about how well the notice was read.
      analyzePage(3, { text: "US POSTAGE smudge smudge smudge", ocr: true, ocrConfidence: 22 }),
    ]);
    expect(documents[0]).toMatchObject({ ocrPages: [1, 2, 3], ocrConfidence: 64 });
  });

  test("OCR repairs seen on real scans", () => {
    const f = (text: string) => analyzePage(1, { text, ocr: true, ocrConfidence: 90 }).fields;
    // A stray I between prefix and number.
    expect(f("Receipt Number\nEACI1809750382 1765 - APPLICATION FOR EMPLOYMENT AUTHORIZATION").receiptNumbers).toEqual([
      "EAC1809750382",
    ]);
    // The Case Type label unreadable ("“use Type"), the I of I-485 read as 1.
    const g = f("Receipt Number “use Type\n10E0929554021 1485 - APPLICATION TO REGISTER PERMANENT RESIDENCE");
    expect(g.formType).toBe("I485");
    expect(g.caseType).toBe("I485 - APPLICATION TO REGISTER PERMANENT RESIDENCE");
    expect(g.receiptNumbers).toEqual(["IOE0929554021"]);
  });

  test("'lofl' under the Page label is 1 of 1", () => {
    expect(analyzePage(1, { text: "Notice Date Page\n01/31/2023 lofl", ocr: true }).pageMarker).toEqual({ index: 1, total: 1 });
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

  test("a notice-like page with no identifiers joins, flagged uncertain", () => {
    const { documents } = split(["A# 123-456-789 letter", "Receipt Number: (smudged)  Notice Date: 09/01/2026"]);
    expect(documents).toHaveLength(1);
    expect(documents[0]!.uncertainPages).toEqual([2]);
  });

  test("a page that isn't a notice (back, envelope) joins quietly and lends no fields", () => {
    const { documents } = split([
      "Notice of Action Receipt Number: IOE0912345678 Case Type: I765 - APPLICATION",
      // The real back of an I-797 names forms and "Notice of Action" in its boilerplate.
      "ADDITIONAL INFORMATION Please save this Form I-797, Notice of Action. If you filed Form I-907, Request for Premium Processing…",
      "US POSTAGE PAID KANSAS CITY MO",
    ]);
    expect(documents.map((d) => d.pages)).toEqual([[1, 2, 3]]);
    expect(documents[0]!.uncertainPages).toEqual([]);
    expect(documents[0]!.fields.formType).toBe("I765");
  });

  test("an envelope scanned first belongs with the notice after it", () => {
    const { documents } = split(["US POSTAGE PAID KANSAS CITY MO", "Notice of Action Receipt Number: IOE0912345678 Page 1 of 1"]);
    expect(documents.map((d) => [d.pages, d.fields.receiptNumbers])).toEqual([[[1, 2], ["IOE0912345678"]]]);
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

describe("clients named anywhere (any document type)", () => {
  // Shaped like a real federal-court Notice of Hearing: no receipt, no
  // A-number, no I-797 labels — just the client's name in the caption.
  const COURT_NOTICE = [
    "NOTICE OF HEARING",
    "UNITED STATES DISTRICT COURT FOR THE DISTRICT OF VERMONT",
    "Norma Xiomara Zavala Leiva",
    "v. Case No. 2:26-cv-253",
    "TAKE NOTICE that the above-entitled case has been scheduled at 03:00 p.m. on Friday, October 09, 2026.",
  ].join("\n");

  test("a court notice finds the client by name and matches her", () => {
    const db = freshDb();
    insertProfile(db, "p1", "Norma X. ZAVALA LEIVA", "094926977");
    insertOpenForm(db, { localId: "f1", profile: "p1", name: "Norma", forms: "I589" });
    const [doc] = scanMailPages(db, [COURT_NOTICE]).documents;
    expect(doc!.fields.names).toEqual(["Norma X. ZAVALA LEIVA"]);
    expect(doc!.match).toMatchObject({ status: "matched", matchedBy: "name" });
    expect(doc!.match.profile?.localId).toBe("p1");
  });

  test("names on file with notes or couples are still found", () => {
    const db = freshDb();
    insertProfile(db, "p1", "Carlos VALENZUELA CASTRO (Maria PRIETO USC)", null);
    insertProfile(db, "p2", "Juan LOPEZ & Ana RUIZ", null);
    const r = scanMailPages(db, ["Applicant: VALENZUELA CASTRO, CARLOS", " ", "Dear Ana Ruiz, your hearing is set."]);
    expect(r.documents.map((d) => d.fields.names)).toEqual([
      ["Carlos VALENZUELA CASTRO (Maria PRIETO USC)"],
      ["Juan LOPEZ & Ana RUIZ"],
    ]);
  });

  test("every name word must be there, close together — scattered words are not a name", () => {
    const db = freshDb();
    insertProfile(db, "p1", "Maria LOPEZ", null);
    const far = `Maria ${"filler word ".repeat(20)} Lopez`;
    expect(scanMailPages(db, [far]).documents[0]!.fields.names).toEqual([]);
    expect(scanMailPages(db, ["Maria Elena Lopez"]).documents[0]!.fields.names).toEqual(["Maria LOPEZ"]);
  });

  test("a client whose name sits inside another found client's is that client read twice", () => {
    const db = freshDb();
    insertProfile(db, "p1", "Ana LOPEZ", null);
    insertProfile(db, "p2", "Ana Maria LOPEZ PEREZ", null);
    expect(scanMailPages(db, ["Ana Maria Lopez Perez"]).documents[0]!.fields.names).toEqual(["Ana Maria LOPEZ PEREZ"]);
  });
});

describe("names", () => {
  test("nameTokens drops accents, titles and punctuation", () => {
    expect(nameTokens("Ms. MARTÍNEZ ANDRÉS, Sarahí")).toEqual(["martinez", "andres", "sarahi"]);
  });

  test("compareNames: order and a missing second surname don't matter; a shared surname alone isn't enough", () => {
    expect(compareNames("MARTINEZ ANDRES, SARAHI", "Sarahi MARTINEZ ANDRES")).toBe("strong");
    expect(compareNames("MARTINEZ ANDRES, SARAHI", "Sarahi Martinez")).toBe("strong");
    expect(compareNames("LOPEZ, MARIA ELENA", "Maria Lopez Garcia")).toBe("partial");
    expect(compareNames("LOPEZ, MARIA", "Juan Lopez")).toBe("none");
  });

  test("normalizeFields moves old rows' people into the name fields", () => {
    const f = normalizeFields({ people: [{ role: "Beneficiary", name: "JUAN LOPEZ" }] } as never);
    expect(f.beneficiary).toBe("JUAN LOPEZ");
    expect(f.receivedDate).toBeNull();
    expect(f.people).toEqual([{ role: "Beneficiary", name: "JUAN LOPEZ" }]);
  });
});

describe("matchNotice with names and dates", () => {
  test("no A-number (first-time beneficiary): the name finds the client", () => {
    const db = freshDb();
    insertProfile(db, "p1", "Sarahi Martinez Andres", null);
    insertProfile(db, "p2", "Juan Lopez", null);
    insertOpenForm(db, { localId: "f1", profile: "p1", name: "Sarahi", forms: "I130" });
    const m = matchNotice(db, fields({ receiptNumbers: ["IOE0912345678"], formType: "I130", beneficiary: "MARTINEZ ANDRES, SARAHI" }));
    expect(m).toMatchObject({ status: "matched", matchedBy: "name", proposedAction: "fill_receipt" });
    expect(m.openForm?.localId).toBe("f1");
    expect(m.message).toMatch(/matched by name/);
  });

  test("an A-number whose client shares no name with the notice is flagged", () => {
    const db = freshDb();
    insertProfile(db, "p1", "Juan Lopez", "123456789");
    insertProfile(db, "p2", "Ana Ruiz", null);
    insertOpenForm(db, { localId: "f1", profile: "p1", name: "Juan", forms: "I130" });
    const m = matchNotice(db, fields({ aNumbers: ["123456789"], formType: "I130", beneficiary: "RUIZ, ANA" }));
    expect(m).toMatchObject({ status: "needs_attention", reason: "name_mismatch" });
    expect(m.candidateProfiles.map((p) => p.localId)).toEqual(["p1", "p2"]);
  });

  test("the petitioner's name is enough to confirm an A-number match", () => {
    const db = freshDb();
    insertProfile(db, "p1", "Juan Lopez", "123456789");
    insertOpenForm(db, { localId: "f1", profile: "p1", name: "Juan", forms: "I130" });
    const m = matchNotice(db, fields({ aNumbers: ["123456789"], formType: "I130", petitioner: "LOPEZ, MARIA", beneficiary: "LOPEZ, JUAN" }));
    expect(m).toMatchObject({ status: "matched", matchedBy: "a_number" });
  });

  test("a receipt on file whose owner shares no name with the notice is flagged", () => {
    const db = freshDb();
    insertProfile(db, "p1", "Juan Lopez", null);
    insertOpenForm(db, { localId: "f1", profile: "p1", name: "Juan", forms: "I130", receipt: "IOE0912345678" });
    const m = matchNotice(db, fields({ receiptNumbers: ["IOE0912345678"], applicant: "RUIZ, ANA" }));
    expect(m).toMatchObject({ status: "needs_attention", reason: "name_mismatch" });
  });

  test("a receipt copied onto two clients' forms: the name decides", () => {
    const db = freshDb();
    insertProfile(db, "p1", "Juan Lopez", null);
    insertProfile(db, "p2", "Ana Ruiz", null);
    insertOpenForm(db, { localId: "f1", profile: "p1", name: "Juan", forms: "I130", receipt: "IOE0912345678" });
    insertOpenForm(db, { localId: "f2", profile: "p2", name: "Ana", forms: "I130", receipt: "IOE0912345678" });
    const m = matchNotice(db, fields({ receiptNumbers: ["IOE0912345678"], beneficiary: "RUIZ, ANA" }));
    expect(m).toMatchObject({ status: "matched", matchedBy: "receipt_number" });
    expect(m.openForm?.localId).toBe("f2");
  });

  test("two empty same-type forms: the received date picks one", () => {
    const db = freshDb();
    insertProfile(db, "p1", "Juan Lopez", "123456789");
    insertOpenForm(db, { localId: "f1", profile: "p1", name: "Juan", forms: "I130", received: "2026-06-01" });
    insertOpenForm(db, { localId: "f2", profile: "p1", name: "Juan", forms: "I130", received: "2026-08-14" });
    const m = matchNotice(db, fields({ receiptNumbers: ["IOE0912345678"], aNumbers: ["123456789"], formType: "I130", receivedDate: "2026-08-14" }));
    expect(m).toMatchObject({ status: "matched", proposedAction: "fill_receipt" });
    expect(m.openForm?.localId).toBe("f2");
    expect(m.message).toMatch(/picked by date/);
  });

  test("only a close name: needs a person, with the candidates", () => {
    const db = freshDb();
    insertProfile(db, "p1", "Maria Lopez Garcia", null);
    const m = matchNotice(db, fields({ receiptNumbers: ["IOE0912345678"], beneficiary: "LOPEZ, MARIA ELENA" }));
    expect(m).toMatchObject({ status: "needs_attention", reason: "name_uncertain" });
    expect(m.candidateProfiles.map((p) => p.localId)).toEqual(["p1"]);
  });

  test("two clients with the same full name: pick one", () => {
    const db = freshDb();
    insertProfile(db, "p1", "Juan Lopez", null);
    insertProfile(db, "p2", "Juan Lopez", null);
    const m = matchNotice(db, fields({ beneficiary: "LOPEZ, JUAN" }));
    expect(m).toMatchObject({ status: "needs_attention", reason: "several_profiles" });
  });

  test("a name alone is enough to try; nothing at all is unreadable", () => {
    const db = freshDb();
    expect(matchNotice(db, fields({ beneficiary: "NOBODY, KNOWN" })).status).toBe("no_match");
    expect(matchNotice(db, fields({})).status).toBe("unreadable");
  });
});
