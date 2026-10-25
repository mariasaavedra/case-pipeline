import { describe, expect, it } from "vitest";
import { contractTitles, sanitizeDocuments, feeKTypeLookup, sanitizeFeeKTypes, scopeFor, type FeeKTypeRow } from "./fee-k-types.js";
import { DRAFT_FEE_K_TYPES } from "./fee-k-types-draft.js";
import { SUGGESTED_DOCUMENTS } from "./fee-k-type-documents-draft.js";

const BLANK: FeeKTypeRow = { feeKType: "", spanish: "", board: "", feeSheetJob: "", services: "", servicesEs: "", excluded: "", excludedEs: "", documents: [] };

describe("sanitizeFeeKTypes", () => {
  it("keeps the Fee K Type's exact spelling, tidies the rest, drops rows with nothing set", () => {
    expect(sanitizeFeeKTypes([
      { feeKType: " Bond MTN  (c) ", spanish: "  Moción   de fianza ", board: "Motions", feeSheetJob: "" },
      { feeKType: "Master (c)", spanish: "", board: "", feeSheetJob: "" },
      { spanish: "sin tipo" },
      "junk",
    ])).toEqual([{ feeKType: "Bond MTN  (c)", spanish: "Moción de fianza", board: "Motions", feeSheetJob: "",
      services: "", servicesEs: "", excluded: "", excludedEs: "", documents: [] }]);
  });

  it("one row per Fee K Type, any case — the first wins", () => {
    const rows = sanitizeFeeKTypes([
      { feeKType: "I-130 - Petition for Alien Relative", board: "Open Forms" },
      { feeKType: "i-130 - petition for alien relative", board: "Court Cases" },
    ]);
    expect(rows.map((r) => r.board)).toEqual(["Open Forms"]);
  });

  it("anything but a list is an empty table", () => {
    expect(sanitizeFeeKTypes({ rows: [] })).toEqual([]);
    expect(sanitizeFeeKTypes(null)).toEqual([]);
  });
});

describe("feeKTypeLookup", () => {
  it("finds a row by Fee K Type, any case and inner spacing", () => {
    const find = feeKTypeLookup([{ ...BLANK, feeKType: "Bond MTN  (c)", board: "Motions" }]);
    expect(find("bond mtn (c)")?.board).toBe("Motions");
    expect(find("Master (c)")).toBeUndefined();
  });
});

describe("the starting draft", () => {
  // Monday's "It will go to…" labels on 2026-10-20.
  const BOARDS = ["Open Forms", "Court Cases", "Waivers", "RFEs", "I-918Bs", "Motions", "FOIA requests", "Appeals",
    "Open Forms-Court Forms", "Interviews", "Litigations", "Already in board"];

  it("survives the sanitizer unchanged: one row per type, every one with a Spanish name", () => {
    expect(sanitizeFeeKTypes(DRAFT_FEE_K_TYPES)).toEqual(DRAFT_FEE_K_TYPES);
    expect(DRAFT_FEE_K_TYPES.every((r) => r.spanish)).toBe(true);
  });

  it("only names real boards", () => {
    expect(DRAFT_FEE_K_TYPES.filter((r) => r.board && !BOARDS.includes(r.board))).toEqual([]);
  });
});

describe("scope of services", () => {
  it("a row with only its scope set is kept; long text is tidied, not cut at 120", () => {
    const long = `Prepare   and file ${"x".repeat(300)}`;
    const [row] = sanitizeFeeKTypes([{ feeKType: "N-400 - Naturalization", services: long }]);
    expect(row!.services).toBe(`Prepare and file ${"x".repeat(300)}`);
  });

  it("joins the scope of a Fee K's types; unknown types add nothing", () => {
    const rows = [
      { ...BLANK, feeKType: "I-130 - Petition for Alien Relative", services: "A.", servicesEs: "A es.", excluded: "No A." },
      { ...BLANK, feeKType: "I-765 - EAD Renewal", services: "B.", servicesEs: "B es." },
    ];
    expect(scopeFor(["i-130 - petition for alien relative", "I-765 - EAD Renewal", "Unknown"], rows))
      .toEqual({ services: "A. B.", servicesEs: "A es. B es.", excluded: "No A.", excludedEs: "" });
    expect(scopeFor([], rows)).toEqual({ services: "", servicesEs: "", excluded: "", excludedEs: "" });
  });

  it("the draft carries the approved text for the example types, on real Fee K Types", () => {
    const withScope = DRAFT_FEE_K_TYPES.filter((r) => r.services);
    expect(withScope.map((r) => r.feeKType)).toContain("I-485 + I-130 - Full Packet");
    expect(withScope).toHaveLength(11);
    for (const r of withScope) expect([r.servicesEs, r.excluded, r.excludedEs].every(Boolean)).toBe(true);
  });
});

describe("contractTitles", () => {
  it("clean English titles + Spanish names, joined; the court marker dropped", () => {
    const rows = [{ ...BLANK, feeKType: "Master (c)", spanish: "Audiencia preliminar (master)" }];
    expect(contractTitles(["Master (c)", "I-765 - EAD Renewal"], rows))
      .toEqual({ en: "Master + I-765 - EAD Renewal", es: "Audiencia preliminar (master) + I-765 - EAD Renewal" });
    expect(contractTitles([], rows)).toEqual({ en: "", es: "" });
  });
});

describe("suggested document lists", () => {
  it("every suggestion is for a real Fee K Type, in both languages, and survives the sanitizer", () => {
    const types = new Set(DRAFT_FEE_K_TYPES.map((r) => r.feeKType));
    for (const [type, docs] of Object.entries(SUGGESTED_DOCUMENTS)) {
      expect(types.has(type), type).toBe(true);
      expect(docs.length, type).toBeGreaterThan(0);
      expect(docs.every((d) => d.en && d.es && d.es !== d.en), type).toBe(true);
      expect(sanitizeDocuments(docs), type).toEqual(docs);
    }
  });

  it("protected case types never name what happened", () => {
    for (const type of ["I-360 - VAWA", "I-914 - TVisa", "I-589 - Affirmative Asylum", "I-485 - UVisa AOS", "I-918B - UVisa Certification Request"]) {
      const text = JSON.stringify(SUGGESTED_DOCUMENTS[type]).toLowerCase();
      expect(text, type).not.toMatch(/abus|crime|crimen|delito|persecu|víctima|victim|traffick|trata|violen/);
    }
  });
});

describe("document checklist", () => {
  it("keeps a row that only has documents; Spanish falls back to English; required by default", () => {
    const [row] = sanitizeFeeKTypes([{ feeKType: "I-130 - Petition for Alien Relative", documents: [
      { en: " Marriage  certificate ", es: "Acta de matrimonio" },
      { en: "Passport", required: false },
    ] }]);
    expect(row!.documents).toEqual([
      { en: "Marriage certificate", es: "Acta de matrimonio", required: true },
      { en: "Passport", es: "Passport", required: false },
    ]);
  });

  it("drops nameless and repeated documents, caps the list", () => {
    expect(sanitizeDocuments([{ en: "" }, { es: "Solo" }, { en: "ID" }, { en: "id" }, "junk"])).toEqual([{ en: "ID", es: "ID", required: true }]);
    expect(sanitizeDocuments(Array.from({ length: 60 }, (_, i) => ({ en: `Doc ${i}` })))).toHaveLength(40);
    expect(sanitizeDocuments(undefined)).toEqual([]);
  });
});
