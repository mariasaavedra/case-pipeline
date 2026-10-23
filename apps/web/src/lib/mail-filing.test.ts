import { describe, expect, it } from "vitest";
import type { NoticeFields } from "../api";
import { cleanMailFileName, defaultMailFileName, mailClientEmail, pickCcFolder, toBase64 } from "./mail-filing";

const fields = (over: Partial<NoticeFields> = {}): NoticeFields => ({
  receiptNumbers: [], aNumbers: [], formType: null, caseType: null, noticeType: null, noticeDate: null,
  receivedDate: null, priorityDate: null, petitioner: null, beneficiary: null, applicant: null,
  dateOfBirth: null, section: null, names: [], people: [], ...over,
});

describe("pickCcFolder", () => {
  it("finds CC however it's spelled, folders only", () => {
    for (const name of ["CC", "cc", "CCs", "CC's", "CC’s", " CC "]) {
      expect(pickCcFolder([{ name: "FEE Ks", folder: {} }, { name, folder: {} }])?.name).toBe(name);
    }
    expect(pickCcFolder([{ name: "CC" }])).toBeNull(); // a file called CC
    expect(pickCcFolder([{ name: "CCC", folder: {} }, { name: "CAF", folder: {} }])).toBeNull();
  });
});

describe("file names", () => {
  it("notice date, type and form; else today and Mail", () => {
    expect(defaultMailFileName(fields({ noticeDate: "2026-10-20", noticeType: "Receipt Notice", formType: "I130" }), "2026-10-23"))
      .toBe("2026-10-20 Receipt Notice I130.pdf");
    expect(defaultMailFileName(fields(), "2026-10-23")).toBe("2026-10-23 Mail.pdf");
  });

  it("strips what SharePoint refuses and keeps one .pdf", () => {
    expect(cleanMailFileName('EOIR: hearing "notice"?.PDF')).toBe("EOIR- hearing -notice--.pdf");
    expect(cleanMailFileName("   ")).toBe("Mail.pdf");
  });
});

describe("mailClientEmail", () => {
  const base = { clientName: "Juan Lopez", senderName: "Rosa", message: "" };

  it("English and Spanish, says what came and where it is", () => {
    const e = mailClientEmail({ ...base, attached: true, fields: fields({ noticeType: "Receipt Notice", formType: "I130", noticeDate: "2026-10-20", receiptNumbers: ["IOE0911111111"] }) });
    expect(e.subject).toBe("Mail received / Correspondencia recibida — Juan Lopez");
    expect(e.text).toContain("Our office received mail about your case: Receipt Notice (I130), dated 2026-10-20, receipt IOE0911111111.");
    expect(e.text).toContain("con fecha 2026-10-20, recibo IOE0911111111");
    expect(e.text).toContain("A copy is attached");
    expect(e.text).toContain("Adjuntamos una copia");
  });

  it("not attached → in their file; the staff message is escaped", () => {
    const e = mailClientEmail({ ...base, attached: false, message: "Call <me>", fields: fields() });
    expect(e.text).toContain("received mail about your case: a letter.");
    expect(e.text).toContain("We saved it in your file.");
    expect(e.text).not.toContain("attached");
    expect(e.html).toContain("Call &lt;me&gt;");
  });
});

describe("toBase64", () => {
  it("round-trips bytes", async () => {
    const b64 = await toBase64(new Blob([new Uint8Array([0, 1, 2, 250, 255])]));
    expect(Array.from(atob(b64), (c) => c.charCodeAt(0))).toEqual([0, 1, 2, 250, 255]);
  });
});
