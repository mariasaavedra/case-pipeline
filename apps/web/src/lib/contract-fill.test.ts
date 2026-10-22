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
  peopleRows,
  contractValues, contractProblems, contractDocumentName, motionEs, CONTRACT_FIELDS, inspectContractTemplate, fillContractTemplate, surchargeFor, unhighlightTags,
  type ContractInput,
} from "./contract-fill";

const INPUT: ContractInput = {
  date: "2026-10-05", clientName: "Ana LOPEZ", salutation: "", email: "ana@example.com",
  address: "123 Main St", cityStateZip: "Kansas City, MO 64105",
  hearingType: "Master Hearing", hearingDate: "2026-11-12", formName: "I-130",
  attorneyFee: 5000, filingFee: 675, postageFee: null, surcharge: null, interviewFee: null,
  bioFee: null, motionName: "", motionNameEs: "", motionFee: null, hearingFee: null,
  dueDate: "", signByDate: "", attorneyName: "Jane Attorney", creatorInitials: "RC",
  multiplePeople: false, people: [],
  trialPrepFee: null, trialPrepDueDate: "", trialFee: null, trialDueDate: "",
};

// The signer (Ana) is a relative; the contract is for three detained people.
const FAMILY: ContractInput = {
  ...INPUT, multiplePeople: true,
  people: [
    { name: "Pedro LOPEZ", aNumber: "111-111-111", dob: "1990-03-04" },
    { name: "Juan LOPEZ", aNumber: "222-222-222", dob: "" },
    { name: "  ", aNumber: "", dob: "" },
    { name: "Maria LOPEZ", aNumber: "", dob: "2015-01-02" },
  ],
};

/** A one-paragraph .docx whose text is `text` (or one paragraph per string). */
function docx(text: string | string[]): ArrayBuffer {
  const paras = (Array.isArray(text) ? text : [text]).map((t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`).join("");
  const zip = new PizZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}</w:body></w:document>`);
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

describe("per-fee surcharges (2026 contracts)", () => {
  it("prints 3% under each fee; N/A when that fee doesn't apply", () => {
    expect(contractValues({ ...INPUT, postageFee: 100 })).toMatchObject({
      attorney_fee_surcharge: "$150.00", filing_fee_surcharge: "$20.25", postage_fee_surcharge: "$3.00",
      bio_fee: "N/A", bio_fee_surcharge: "N/A",
    });
    expect(contractValues(INPUT)).toMatchObject({ postage_fee_surcharge: "N/A" });
    expect(contractValues({ ...INPUT, bioFee: 30 })).toMatchObject({ bio_fee: "$30.00", bio_fee_surcharge: "$0.90" });
  });

  it("splits the attorney fee in halves (trial, BIA appeal)", () => {
    expect(contractValues({ ...INPUT, attorneyFee: 7001 })).toMatchObject({ attorney_fee_half: "$3,500.50", attorney_fee_half_surcharge: "$105.02" });
  });

  it("bond motion + hearing fees are their own blanks, each required", () => {
    const check = inspectContractTemplate(docx("{{motion_fee}} {{motion_fee_surcharge}} {{hearing_fee}} {{hearing_fee_surcharge}} by {{sign_by_date}}"));
    expect(check.unknown).toEqual([]);
    expect(contractProblems(check, INPUT)).toEqual([
      "Attorney fee for the motion is missing", "Surcharge on the motion fee (3%) is missing",
      "Attorney fee for the hearing is missing", "Surcharge on the hearing fee (3%) is missing",
      "Signed contract due is missing",
    ]);
    const ok = { ...INPUT, motionFee: 1500, hearingFee: 1000, signByDate: "2026-10-10" };
    expect(contractProblems(check, ok)).toEqual([]);
    expect(contractValues(ok)).toMatchObject({ motion_fee_surcharge: "$45.00", hearing_fee_surcharge: "$30.00", sign_by_date: "October 10, 2026", sign_by_date_es: "10 de Octubre, 2026" });
  });
});

describe("contractDocumentName", () => {
  it("is Client name - Form(s)/Matter - MM-DD-YYYY", () => {
    expect(contractDocumentName({ ...INPUT, formName: "I-212" })).toBe("Ana LOPEZ - I-212 - 10-05-2026");
  });
  it("keeps the English half of a bilingual title, capped at a word", () => {
    const long = "I-212 Application for Permission to Reapply for Admission into the United States After Deportation or Removal / I-212 Aplicación de Permiso";
    const name = contractDocumentName({ ...INPUT, formName: long });
    expect(name).toBe("Ana LOPEZ - I-212 Application for Permission to Reapply for Admission into the United… - 10-05-2026");
  });
  it("falls back to the hearing type, and drops characters a file name can't hold", () => {
    expect(contractDocumentName({ ...INPUT, formName: "", clientName: "Ana / LOPEZ" })).toBe("Ana LOPEZ - Master Hearing - 10-05-2026");
  });
  it("names a Master Hearing + motion contract after the motion, only when the template has one", () => {
    const f = { ...INPUT, motionName: "Motion to Recalendar" };
    expect(contractDocumentName(f, ["motion_name", "hearing_date"])).toBe("Ana LOPEZ - Master Hearing + Motion to Recalendar - 10-05-2026");
    expect(contractDocumentName(f, ["form_name"])).toBe("Ana LOPEZ - I-130 - 10-05-2026");
  });
});

describe("motions", () => {
  it("knows the Spanish name of a listed motion, any case", () => {
    expect(motionEs("motion to administratively close")).toBe("Moción de Cierre Administrativo");
    expect(motionEs("Motion to Suppress")).toBe("");
  });
  it("requires both names and prints them as typed", () => {
    const fields = CONTRACT_FIELDS.filter((x) => x.tag.startsWith("motion_name"));
    expect(fields.map((x) => x.required!(INPUT))).toEqual([true, true]);
    const f = { ...INPUT, motionName: " Motion to Reopen ", motionNameEs: "Moción para Reabrir" };
    expect(contractValues(f)).toMatchObject({ motion_name: "Motion to Reopen", motion_name_es: "Moción para Reabrir" });
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

describe("several people on one contract", () => {
  it("lists only the people typed in — the signer isn't assumed to be one; empty rows don't count", () => {
    expect(contractValues(FAMILY)).toMatchObject({
      people_names: "Pedro LOPEZ, Juan LOPEZ and Maria LOPEZ", people_names_es: "Pedro LOPEZ, Juan LOPEZ y Maria LOPEZ", people_count: "3",
    });
    expect(peopleRows(FAMILY).map((r) => [r.person_number, r.person_name, r.person_a_number, r.person_dob])).toEqual([
      ["1", "Pedro LOPEZ", "111-111-111", "March 4, 1990"],
      ["2", "Juan LOPEZ", "222-222-222", ""],
      ["3", "Maria LOPEZ", "", "January 2, 2015"],
    ]);
  });

  it("unticked: nobody listed, and a sentence names the client alone", () => {
    expect(peopleRows({ ...FAMILY, multiplePeople: false })).toEqual([]);
    expect(contractValues({ ...FAMILY, multiplePeople: false })).toMatchObject({ people_names: "Ana LOPEZ", people_count: "1" });
  });

  const TEMPLATE = docx([
    "RE: {{hearing_type}}", "{{#has_people}}", "Persons:", "{{#people}}",
    "{{person_number}}. {{person_name}}{{#person_a_number}}, A# {{person_a_number}}{{/person_a_number}} ({{hearing_type}})",
    "{{/people}}", "{{/has_people}}", "Fee {{attorney_fee}}",
  ]);
  const text = async (input: ContractInput) => {
    const xml = new PizZip(await fillContractTemplate(TEMPLATE, input).arrayBuffer()).file("word/document.xml")!.asText();
    return [...xml.matchAll(/<w:p>[\s\S]*?<\/w:p>/g)].map((m) => [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join("")).join("|");
  };

  it("prints the block once per person; A# only when typed; contract fields reachable inside", async () => {
    const check = inspectContractTemplate(TEMPLATE);
    expect(check.unknown).toEqual([]);
    expect(check.tags).toEqual(expect.arrayContaining(["has_people", "people", "person_name", "person_number", "person_a_number"]));
    expect(contractProblems(check, FAMILY)).toEqual([]);
    expect(await text(FAMILY)).toBe(
      "RE: Master Hearing|Persons:|1. Pedro LOPEZ, A# 111-111-111 (Master Hearing)|2. Juan LOPEZ, A# 222-222-222 (Master Hearing)|3. Maria LOPEZ (Master Hearing)|Fee $5,000.00",
    );
  });

  it("a one-person contract prints without the block at all", async () => {
    expect(await text(INPUT)).toBe("RE: Master Hearing|Fee $5,000.00");
  });

  it("ticked needs at least two people", () => {
    const check = inspectContractTemplate(TEMPLATE);
    const one = { ...FAMILY, people: [{ name: "Pedro LOPEZ", aNumber: "", dob: "" }] };
    expect(contractProblems(check, one)).toEqual(['List at least 2 people, or untick "Contract is for more than one person"']);
    // A template that doesn't list people doesn't care.
    expect(contractProblems(inspectContractTemplate(docx("Fee {{attorney_fee}}")), one)).toEqual([]);
  });

  it("names the file after the client, with how many people", () => {
    expect(contractDocumentName(FAMILY)).toBe("Ana LOPEZ - I-130 (3 people) - 10-05-2026");
    expect(contractDocumentName(INPUT)).toBe("Ana LOPEZ - I-130 - 10-05-2026");
  });
});

describe("trial: prep and trial are separate fees", () => {
  const TRIAL: ContractInput = { ...INPUT, trialPrepFee: 3000, trialPrepDueDate: "2026-11-01", trialFee: 4500, trialDueDate: "2027-01-15" };

  it("prints each fee, its 3% and its own deadline", () => {
    expect(contractValues(TRIAL)).toMatchObject({
      trial_prep_fee: "$3,000.00", trial_prep_fee_surcharge: "$90.00", trial_prep_due_date: "November 1, 2026", trial_prep_due_date_es: "1 de Noviembre, 2026",
      trial_fee: "$4,500.00", trial_fee_surcharge: "$135.00", trial_due_date: "January 15, 2027", trial_due_date_es: "15 de Enero, 2027",
      trial_total_fee: "$7,500.00",
    });
  });

  it("requires both fees and dates when the template uses them", () => {
    const check = inspectContractTemplate(docx("{{trial_prep_fee}} by {{trial_prep_due_date}}, {{trial_fee}} by {{trial_due_date}}"));
    expect(contractProblems(check, TRIAL)).toEqual([]);
    expect(contractProblems(check, INPUT)).toEqual(["Trial prep fee is missing", "Trial prep fee due is missing", "Trial fee is missing", "Trial fee due is missing"]);
  });
});
