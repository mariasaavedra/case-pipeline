// =============================================================================
// Contract template tests
// =============================================================================
// What matters: values print the way the contracts print them, the surcharge
// and total follow the 2026 rules, a template's typos are caught, and only the
// blanks a template actually uses are required.
// =============================================================================

import { describe, it, expect } from "vitest";
import PizZip from "pizzip";
import {
  contractValues, contractProblems, inspectContractTemplate, fillContractTemplate, surchargeFor, unhighlightTags,
  type ContractInput,
} from "./contract-fill";

const INPUT: ContractInput = {
  date: "2026-10-05", clientName: "Ana LOPEZ", salutation: "", email: "ana@example.com",
  address: "123 Main St", cityStateZip: "Kansas City, MO 64105",
  hearingType: "Master Hearing", hearingDate: "2026-11-12", formName: "I-130",
  attorneyFee: 5000, filingFee: 675, postageFee: null, surcharge: null, interviewFee: null,
  dueDate: "", attorneyName: "Jane Attorney", creatorInitials: "RC",
};

/** A one-paragraph .docx whose text is `text`. */
function docx(text: string): ArrayBuffer {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generate({ type: "arraybuffer" });
}

describe("contractValues", () => {
  it("prints amounts with $, dates in words, N/A postage", () => {
    const v = contractValues(INPUT);
    expect(v).toMatchObject({
      date: "October 5, 2026", date_es: "5 de Octubre, 2026", salutation: "Ana LOPEZ",
      address_full: "123 Main St, Kansas City, MO 64105", hearing_date: "November 12, 2026",
      attorney_fee: "$5,000.00", filing_fee: "$675.00", postage_fee: "N/A",
      // 3% of AF + FF (5000 + 675; no postage).
      surcharge: "$170.25", total_fee: "$5,845.25",
    });
  });

  it("surcharge is 3% of AF + FF + postage; a typed one wins", () => {
    expect(surchargeFor(3500)).toBe(105);
    expect(surchargeFor(5000, 675, 100)).toBe(173.25);
    expect(contractValues({ ...INPUT, surcharge: 0, postageFee: 100 })).toMatchObject({ surcharge: "$0.00", postage_fee: "$100.00", total_fee: "$5,775.00" });
  });
});

describe("inspect + problems", () => {
  it("lists the template's fields and needs only those", () => {
    const check = inspectContractTemplate(docx("Dear {{client_name}}, fee {{attorney_fee}} on {{hearing_date}}"));
    expect(check).toEqual({ tags: ["client_name", "hearing_date", "attorney_fee"], unknown: [], signTags: [], errors: [] });
    expect(contractProblems(check, INPUT)).toEqual([]);
    expect(contractProblems(check, { ...INPUT, hearingDate: "" })).toEqual(["Hearing date is missing"]);
    // form_name is empty-able here because this template doesn't use it
    expect(contractProblems(check, { ...INPUT, formName: "" })).toEqual([]);
  });

  it("catches a typo'd field", () => {
    const check = inspectContractTemplate(docx("Dear {{clinet_name}}"));
    expect(check.unknown).toEqual(["clinet_name"]);
    expect(contractProblems(check, INPUT)[0]).toMatch(/clinet_name/);
  });

  it("catches a broken tag instead of throwing", () => {
    const check = inspectContractTemplate(docx("Dear {{client_name}"));
    expect(check.errors.length).toBeGreaterThan(0);
  });
});

it("fills a template", async () => {
  const out = fillContractTemplate(docx("Dear {{salutation}}, total {{total_fee}}"), INPUT);
  const xml = new PizZip(await out.arrayBuffer()).file("word/document.xml")!.asText();
  expect(xml).toContain("Dear Ana LOPEZ, total $5,845.25");
});

it("passes Adobe Sign text tags through untouched", async () => {
  const text = "Fee {{attorney_fee}} {{Sig_es_:signer1:signature}} {{Int_es_:signer2:initials}} {{*Addr_es_:signer2        }}";
  const check = inspectContractTemplate(docx(text));
  expect(check.unknown).toEqual([]);
  expect(check.signTags).toEqual(["Sig_es_:signer1:signature", "Int_es_:signer2:initials", "*Addr_es_:signer2"]);
  const out = fillContractTemplate(docx(text), INPUT);
  const xml = new PizZip(await out.arrayBuffer()).file("word/document.xml")!.asText();
  expect(xml).toContain("Fee $5,000.00 {{Sig_es_:signer1:signature}} {{Int_es_:signer2:initials}} {{*Addr_es_:signer2        }}");
});

describe("the template's highlight on blanks", () => {
  const HL = '<w:highlight w:val="magenta"/>';
  const run = (text: string, hl = true) => `<w:r><w:rPr><w:b/>${hl ? HL : ""}</w:rPr><w:t>${text}</w:t></w:r>`;

  it("is dropped from a tag, even one split over runs; other highlights stay", () => {
    const xml = run("Note:") + run("{{client") + run("_name}}") + run(" and ", false) + run("{{date}}");
    const out = unhighlightTags(xml);
    expect(out).toBe(run("Note:") + run("{{client", false) + run("_name}}", false) + run(" and ", false) + run("{{date}}", false));
  });

  it("never reaches the filled contract", async () => {
    const zip = new PizZip(docx("x"));
    zip.file("word/document.xml", zip.file("word/document.xml")!.asText()
      .replace(/<w:p>.*<\/w:p>/, `<w:p>${run("Dear ", false)}${run("{{salutation}}")}</w:p>`));
    const out = fillContractTemplate(zip.generate({ type: "arraybuffer" }), INPUT);
    const xml = new PizZip(await out.arrayBuffer()).file("word/document.xml")!.asText();
    expect(xml).toContain("Ana LOPEZ");
    expect(xml).not.toContain("w:highlight");
  });
});
