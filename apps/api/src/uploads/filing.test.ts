import { describe, it, expect } from "vitest";
import { alreadyFiled, kindSummary, pickCafFolder, uploadNoteHtml } from "./filing.js";

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
});
