// =============================================================================
// Mail layout reader tests
// =============================================================================
// Built the way a real I-797 is: labels in a row, values beneath them in the
// same column. The case that matters most is the EMPTY one — a blank Priority
// Date must stay blank, not borrow the Notice Date printed beside it.
// =============================================================================

import { test, expect, describe } from "vitest";
import { readLayout, wordsFromText, type Word } from "./mail-layout";
import { extractNoticeFields, parseNoticeDate, cleanName, analyzePage, splitIntoDocuments } from "./mail";

/** Place a phrase at (x, y); each word gets width 6/char and a space of 6. */
function at(text: string, x: number, y: number): Word[] {
  const out: Word[] = [];
  let cx = x;
  for (const w of text.split(" ")) {
    out.push({ text: w, x0: cx, x1: cx + w.length * 6, y0: y, y1: y + 10 });
    cx += w.length * 6 + 6;
  }
  return out;
}

const I797: Word[] = [
  ...at("Receipt Number", 50, 0),
  ...at("Case Type", 300, 0),
  ...at("IOE0912345678", 50, 16),
  ...at("I130 - PETITION FOR ALIEN RELATIVE", 300, 16),
  ...at("Received Date", 50, 40),
  ...at("Priority Date", 170, 40),
  ...at("Notice Date", 290, 40),
  ...at("Page", 410, 40),
  ...at("08/14/2026", 50, 56),
  ...at("August 20, 2026", 290, 56),
  ...at("1 of 1", 410, 56),
  ...at("Petitioner", 50, 80),
  ...at("Beneficiary", 300, 80),
  ...at("LOPEZ, MARIA", 50, 96),
  ...at("LOPEZ, JUAN A# 123-456-789", 300, 96),
  ...at("123 MAIN ST", 50, 108),
  ...at("Notice Type: Receipt Notice", 50, 140),
  ...at("Section: Husband or wife of U.S. citizen, 201(b) INA", 50, 156),
  ...at("We have received your petition. This notice does not grant any status.", 50, 190),
];

describe("readLayout", () => {
  test("grid I-797: each value comes from under its own label", () => {
    const v = readLayout("", I797);
    expect(v).toMatchObject({
      receiptNumber: "IOE0912345678",
      caseType: "I130 - PETITION FOR ALIEN RELATIVE",
      receivedDate: "08/14/2026",
      noticeDate: "August 20, 2026",
      page: "1 of 1",
      petitioner: "LOPEZ, MARIA",
      noticeType: "Receipt Notice",
      section: "Husband or wife of U.S. citizen, 201(b) INA",
    });
    // Blank on the notice → absent here, not the Notice Date next door.
    expect(v.priorityDate).toBeUndefined();
    // The beneficiary line carries an A-number; the label split keeps them apart.
    expect(v.beneficiary).toBe("LOPEZ, JUAN");
    expect(v.aNumber).toBe("123-456-789");
  });

  test("a name takes only its first line, not the address under it", () => {
    expect(readLayout("", I797).petitioner).toBe("LOPEZ, MARIA");
  });

  test("inline 'Label: value' works from plain text", () => {
    const v = readLayout("Receipt Number: IOE0912345678 Case Type: I-485\nApplicant: ANA RUIZ\nNotice Date: 09/01/2026");
    expect(v).toMatchObject({ receiptNumber: "IOE0912345678", caseType: "I-485", applicant: "ANA RUIZ", noticeDate: "09/01/2026" });
  });

  test("a label word in ordinary prose is not a field", () => {
    const v = readLayout("This decision was made under the section of the Act that governs your petition and the applicant's rights.");
    expect(v.section).toBeUndefined();
    expect(v.applicant).toBeUndefined();
  });

  test("the next header row is never taken as a value", () => {
    const words = [...at("Priority Date", 50, 0), ...at("Notice Date", 200, 0), ...at("Petitioner", 50, 16), ...at("Beneficiary", 200, 16)];
    expect(readLayout("", words)).toEqual({});
  });

  test("wordsFromText keeps lines and order", () => {
    const w = wordsFromText("A B\nC");
    expect(w.map((x) => [x.text, x.y0])).toEqual([["A", 0], ["B", 0], ["C", 1]]);
  });
});

describe("extractNoticeFields with positions", () => {
  test("every field of a grid I-797, normalized", () => {
    const f = extractNoticeFields("", I797);
    expect(f).toMatchObject({
      receiptNumbers: ["IOE0912345678"],
      aNumbers: ["123456789"],
      formType: "I130",
      caseType: "I130 - PETITION FOR ALIEN RELATIVE",
      noticeType: "Receipt Notice",
      receivedDate: "2026-08-14",
      priorityDate: null,
      noticeDate: "2026-08-20",
      petitioner: "LOPEZ, MARIA",
      beneficiary: "LOPEZ, JUAN",
      section: "Husband or wife of U.S. citizen, 201(b) INA",
    });
    expect(f.people).toEqual([
      { role: "Petitioner", name: "LOPEZ, MARIA" },
      { role: "Beneficiary", name: "LOPEZ, JUAN" },
    ]);
  });

  test("OCR'd values are repaired by what the field must be", () => {
    const words = [
      ...at("Receipt Number", 50, 0),
      ...at("Case Type", 300, 0),
      ...at("I0E09l2345678", 50, 16),
      ...at("1-130", 300, 16),
      ...at("Received Date", 50, 40),
      ...at("O8/l4/2O26", 50, 56),
    ];
    const f = extractNoticeFields("", words, true);
    expect(f.receiptNumbers).toEqual(["IOE0912345678"]);
    expect(f.formType).toBe("I130");
    expect(f.receivedDate).toBe("2026-08-14");
  });
});

describe("value parsers", () => {
  test("parseNoticeDate", () => {
    expect(parseNoticeDate("08/14/2026")).toBe("2026-08-14");
    expect(parseNoticeDate("August 4, 2026")).toBe("2026-08-04");
    expect(parseNoticeDate("2026-08-14")).toBe("2026-08-14");
    expect(parseNoticeDate("N/A")).toBeNull();
    expect(parseNoticeDate("13/40/2026")).toBeNull();
    expect(parseNoticeDate("O8/14/2O26")).toBeNull(); // only repaired when OCR'd
    expect(parseNoticeDate("O8/14/2O26", true)).toBe("2026-08-14");
  });

  test("cleanName drops what shares the name's line", () => {
    expect(cleanName("LOPEZ, JUAN A123456789")).toBe("LOPEZ, JUAN");
    expect(cleanName("MARTÍNEZ ANDRÉS, SARAHI")).toBe("MARTÍNEZ ANDRÉS, SARAHI");
    expect(cleanName("  12345 ")).toBeNull();
  });
});

describe("grid page numbers split notices", () => {
  test("'Page' over '2 of 2' keeps the second page with its notice", () => {
    const page1 = { text: "x", words: I797.map((w) => (w.text === "1" ? { ...w, text: "1" } : w)) };
    const grid2 = [...at("Page", 50, 0), ...at("2 of 2", 50, 16), ...at("Please keep this notice.", 50, 60)];
    const p2 = { text: "Please keep this notice.", words: grid2 };
    const a = analyzePage(1, { text: "Notice of Action", words: [...page1.words, ...at("Notice of Action", 50, 220)] });
    const b = analyzePage(2, p2);
    expect(b.pageMarker).toEqual({ index: 2, total: 2 });
    expect(splitIntoDocuments([a, b]).documents.map((d) => d.pages)).toEqual([[1, 2]]);
  });
});

describe("OCR quirks in labelled values", () => {
  test("a case type read as 1765 is the I-765; a page read as 20f2 is 2 of 2", () => {
    const words = [...at("Case Type", 50, 0), ...at("1765 - APPLICATION FOR WORK PERMIT", 50, 16), ...at("Page", 300, 0), ...at("20f2", 300, 16)];
    const p = analyzePage(1, { text: "x", words, ocr: true, ocrConfidence: 90 });
    expect(p.fields.formType).toBe("I765");
    expect(p.fields.caseType).toBe("I765 - APPLICATION FOR WORK PERMIT");
    expect(p.pageMarker).toEqual({ index: 2, total: 2 });
  });

  test("the other glyphs OCR mistakes for an I", () => {
    for (const glyph of ["[", "|", "l", "!"]) {
      const words = [...at("Case Type", 50, 0), ...at(`${glyph}131 - APPLICATION FOR TRAVEL DOCUMENT`, 50, 16)];
      expect(analyzePage(1, { text: "x", words, ocr: true }).fields.formType).toBe("I131");
    }
  });

  test("without OCR, 1765 stays as printed (and isn't a case type)", () => {
    const words = [...at("Case Type", 50, 0), ...at("1765 - APPLICATION", 50, 16)];
    expect(analyzePage(1, { text: "x", words }).fields.caseType).toBeNull();
  });
});
