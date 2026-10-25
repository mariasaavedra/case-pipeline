import { describe, it, expect } from "vitest";
import { alreadyFiled, evidenceFolder, folderFor, kindSummary, pickCafFolder, pickFolder, uploadNoteHtml } from "./filing.js";

describe("evidenceFolder / folderFor", () => {
  it("EVIDENCE + the Fee K Type, court marker and unsafe characters out; no type = CAF", () => {
    expect(evidenceFolder("I-130 - Petition for Alien Relative")).toBe("EVIDENCE I-130 - Petition for Alien Relative");
    expect(evidenceFolder("Bond MTN  (c)")).toBe("EVIDENCE Bond MTN");
    expect(evidenceFolder("U Visa / I-918")).toBe("EVIDENCE U Visa I-918");
    expect(folderFor(null)).toBe("CAF");
    expect(folderFor("FOIA")).toBe("EVIDENCE FOIA");
  });

  it("pickFolder finds it in any capitalisation and spacing", () => {
    const kids = [{ name: "evidence  i-130", folder: {} }, { name: "EVIDENCE FOIA", file: {} }];
    expect(pickFolder(kids, "EVIDENCE I-130")?.name).toBe("evidence  i-130");
    expect(pickFolder(kids, "EVIDENCE FOIA")).toBeNull();
  });
});

describe("pickCafFolder", () => {
  it("finds CAF in any capitalisation, folders only", () => {
    expect(pickCafFolder([{ name: "CAF", file: {} }, { name: " caf ", folder: {} }])?.name).toBe(" caf ");
    expect(pickCafFolder([{ name: "CAFE", folder: {} }, { name: "FEE Ks", folder: {} }])).toBeNull();
  });
});

describe("alreadyFiled", () => {
  const caf = [{ name: "2026-10-21 Notice - a.pdf", file: {}, size: 10 }];
  it("same name (any case) and size = filed; a different size is a different file", () => {
    expect(alreadyFiled(caf, "2026-10-21 notice - A.pdf", 10)).toBe(caf[0]);
    expect(alreadyFiled(caf, "2026-10-21 Notice - a.pdf", 11)).toBeNull();
  });
});

describe("kindSummary", () => {
  it("counts, most first, singular / plural", () => {
    expect(kindSummary(["notice", "id", "notice"])).toBe("2 notices, 1 ID");
    expect(kindSummary(["other"])).toBe("1 document");
    expect(kindSummary(["evidence", "evidence"])).toBe("2 evidence");
  });
});

describe("uploadNoteHtml", () => {
  it("lists each file linked, the client's note quoted and escaped", () => {
    const html = uploadNoteHtml([
      { storedName: "2026-10-21 Notice - a.pdf", kind: "notice", note: "del <USCIS>", sharepointUrl: "https://sp/a", filedWhere: "E-File" },
      { storedName: "2026-10-21 ID - b.jpg", kind: "id", note: null, sharepointUrl: "https://sp/b?x=1&y=2", filedWhere: "E-File" },
    ]);
    expect(html).toContain("The client sent 2 documents through their upload link (1 notice, 1 ID). Filed in their E-File → CAF.");
    expect(html).toContain('<li><a href="https://sp/a">2026-10-21 Notice - a.pdf</a> — “del &lt;USCIS&gt;”</li>');
    expect(html).toContain('href="https://sp/b?x=1&amp;y=2"');
  });

  it("names each folder and the checklist documents the files were for", () => {
    const html = uploadNoteHtml([
      { storedName: "2026-10-23 Passport - a.jpg", kind: "evidence", note: null, sharepointUrl: "https://sp/a", filedWhere: "E-File", folder: "EVIDENCE I-130", document: "Passport" },
      { storedName: "2026-10-23 Passport - b.jpg", kind: "evidence", note: null, sharepointUrl: "https://sp/b", filedWhere: "E-File", folder: "EVIDENCE I-130", document: "Passport" },
      { storedName: "2026-10-23 Notice - c.pdf", kind: "notice", note: null, sharepointUrl: "https://sp/c", filedWhere: "E-File" },
    ]);
    expect(html).toContain("Filed in their E-File → EVIDENCE I-130, CAF. For their checklist: Passport.");
  });
});
